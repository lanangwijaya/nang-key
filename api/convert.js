import { decompress as zstdDecompress } from "fzstd";

const RBXM_MAGIC = Buffer.from([0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZSTD_MAGIC = 0xFD2FB528;

function lz4DecompressBlock(input, expectedSize) {
  const out = new Uint8Array(expectedSize);
  let ip = 0, op = 0;
  while (ip < input.length && op < expectedSize) {
    const token = input[ip++];
    let litLen = token >> 4;
    let matchLen = (token & 0x0F) + 4;
    if (litLen === 15) {
      let b;
      do { b = input[ip++]; litLen += b; } while (b === 255);
    }
    for (let i = 0; i < litLen; i++) out[op++] = input[ip++];
    if (op >= expectedSize) break;
    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;
    if (matchLen === 19) {
      let b;
      do { b = input[ip++]; matchLen += b; } while (b === 255);
    }
    const matchStart = op - offset;
    for (let i = 0; i < matchLen; i++) out[op++] = out[matchStart + i];
  }
  return Buffer.from(out.buffer, out.byteOffset, op);
}

function parseChunks(buf) {
  const hdr = buf.slice(0, 8).toString("binary");
  if (hdr !== "<roblox!" && hdr !== "<roblox ") throw new Error("Bukan file binary Roblox");
  if (!buf.slice(8, 14).equals(RBXM_MAGIC)) throw new Error("Binary magic salah");

  let off = 16;
  off += 4;
  off += 4;
  off += 8;

  const chunks = [];
  const validNames = new Set(["META", "SSTR", "INST", "PROP", "PRNT", "SIGN", "END\u0000"]);

  while (off + 16 <= buf.length) {
    const name = buf.slice(off, off + 4).toString("binary");
    off += 4;
    if (!validNames.has(name)) throw new Error("Chunk header unknown: " + JSON.stringify(name));

    const compLen = buf.readUInt32LE(off); off += 4;
    const decompLen = buf.readUInt32LE(off); off += 4;
    off += 4;

    let data;
    if (compLen === 0) {
      data = buf.slice(off, off + decompLen);
      off += decompLen;
    } else {
      const slice = buf.slice(off, off + compLen);
      off += compLen;
      const magic = slice.readUInt32LE(0);
      if (magic === ZSTD_MAGIC) {
        data = Buffer.from(zstdDecompress(slice));
      } else {
        data = lz4DecompressBlock(slice, decompLen);
      }
    }
    chunks.push({ name, data });
    if (name === "END\u0000") break;
  }
  return chunks;
}

class Reader {
  constructor(buf) { this.buf = buf; this.off = 0; }
  u8()  { return this.buf[this.off++]; }
  u32() { const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  f64le() { const v = this.buf.readDoubleLE(this.off); this.off += 8; return v; }
  bytes(n) { const s = this.buf.slice(this.off, this.off + n); this.off += n; return s; }
  string() {
    const len = this.u32();
    const s = this.buf.slice(this.off, this.off + len).toString("utf8");
    this.off += len;
    return s.replace(/\0+$/, "");
  }
}

function deinterleave(raw, count, size) {
  const out = Buffer.alloc(count * size);
  for (let i = 0; i < count; i++) {
    for (let s = 0; s < size; s++) {
      out[i * size + s] = raw[s * count + i];
    }
  }
  return out;
}

function zigzag(v) { return (v % 2 === 0) ? v / 2 : -(v + 1) / 2; }

function readInt32Array(reader, count) {
  if (count <= 0) return [];
  const raw = reader.bytes(count * 4);
  const buf = deinterleave(raw, count, 4);
  const out = [];
  for (let i = 0; i < count; i++) out.push(zigzag(buf.readInt32BE(i * 4)));
  return out;
}

function readFloat32Array(reader, count) {
  if (count <= 0) return [];
  const raw = reader.bytes(count * 4);
  const buf = deinterleave(raw, count, 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = buf.readUInt32BE(i * 4);
    const rotated = ((v >>> 1) | ((v & 1) << 31)) >>> 0;
    const tmp = Buffer.alloc(4);
    tmp.writeUInt32BE(rotated);
    out.push(tmp.readFloatBE(0));
  }
  return out;
}

function readReferentArray(reader, count) {
  if (count <= 0) return [];
  const deltas = readInt32Array(reader, count);
  const out = [];
  let last = 0;
  for (const d of deltas) {
    last += d;
    out.push(last);
  }
  return out;
}

function decodeINST(chunkBuf) {
  const r = new Reader(chunkBuf);
  const classId = r.u32();
  const className = r.string();
  const isService = r.u8() === 1;
  const count = r.u32();
  const refs = readReferentArray(r, count);
  return { classId, className, isService, refs };
}

const T_STRING  = 0x01;
const T_BOOL    = 0x02;
const T_I32     = 0x03;
const T_F32     = 0x04;
const T_F64     = 0x05;
const T_REF     = 0x13;
const T_STR_ALT = 0x1D;

function decodePROP(chunkBuf, classDefs) {
  const r = new Reader(chunkBuf);
  const classId = r.u32();
  const classDef = classDefs[classId];
  if (!classDef) throw new Error("class id " + classId + " unknown");
  const sizeof = classDef.refs.length;
  const propName = r.string();

  if (r.buf[r.off] === 0x1E) r.off += 1;
  const typeByte = r.u8();

  const props = [];

  if (typeByte === T_STRING || typeByte === T_STR_ALT) {
    for (let i = 0; i < sizeof; i++) props.push(r.string());
  } else if (typeByte === T_BOOL) {
    for (let i = 0; i < sizeof; i++) props.push(r.u8() !== 0);
  } else if (typeByte === T_I32) {
    props.push(...readInt32Array(r, sizeof));
  } else if (typeByte === T_F32) {
    props.push(...readFloat32Array(r, sizeof));
  } else if (typeByte === T_F64) {
    for (let i = 0; i < sizeof; i++) props.push(r.f64le());
  } else if (typeByte === T_REF) {
    props.push(...readReferentArray(r, sizeof));
  } else {
    return { classId, refs: classDef.refs, propName, props: null, unknownType: typeByte };
  }

  return { classId, refs: classDef.refs, propName, props };
}

function esc(s) {
  if (typeof s !== "string") return String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

let REF = 0;
function nextRef() { return "RBX" + (REF++).toString(36).toUpperCase(); }

function emitProp(name, value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") {
    return `<bool name="${esc(name)}">${value ? "true" : "false"}</bool>`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) return `<int name="${esc(name)}">${value}</int>`;
    return `<float name="${esc(name)}">${value}</float>`;
  }
  if (typeof value === "string") {
    if (name === "Source" || name === "ContentText") {
      return `<ProtectedString name="${esc(name)}"><![CDATA[${value}]]></ProtectedString>`;
    }
    if (/^rbxassetid:\/\//.test(value) || /^rbxasset:\/\//.test(value) || /^https?:/.test(value)) {
      return `<Content name="${esc(name)}"><url>${esc(value)}</url></Content>`;
    }
    return `<string name="${esc(name)}">${esc(value)}</string>`;
  }
  return "";
}

function emitItem(node, indent) {
  const pad = "  ".repeat(indent);
  const p2 = "  ".repeat(indent + 1);
  const p3 = "  ".repeat(indent + 2);

  let out = `${pad}<Item class="${esc(node.className)}" referent="${nextRef()}">\n`;
  out += `${p2}<Properties>\n`;

  const props = node.properties || {};
  if (props.Name === undefined) props.Name = node.className;
  for (const [k, v] of Object.entries(props)) {
    const line = emitProp(k, v);
    if (line) out += `${p3}${line}\n`;
  }

  out += `${p2}</Properties>\n`;
  for (const child of node.children || []) {
    out += emitItem(child, indent + 1);
  }
  out += `${pad}</Item>\n`;
  return out;
}

function binaryToXml(buf) {
  const chunks = parseChunks(buf);
  const classDefs = {};
  const instances = new Map();

  for (const ch of chunks) {
    if (ch.name !== "INST") continue;
    const def = decodeINST(ch.data);
    classDefs[def.classId] = def;
    for (const ref of def.refs) {
      instances.set(ref, {
        className: def.className,
        properties: {},
        children: [],
        ref,
        parentRef: null,
      });
    }
  }

  for (const ch of chunks) {
    if (ch.name !== "PROP") continue;
    try {
      const p = decodePROP(ch.data, classDefs);
      if (!p.props) continue;
      for (let i = 0; i < p.refs.length; i++) {
        const inst = instances.get(p.refs[i]);
        if (inst) inst.properties[p.propName] = p.props[i];
      }
    } catch (e) {
      console.warn("[convert] PROP skip:", e.message);
    }
  }

  for (const ch of chunks) {
    if (ch.name !== "PRNT") continue;
    const r = new Reader(ch.data);
    r.u8();
    const count = r.u32();
    const childRefs = readReferentArray(r, count);
    const parentRefs = readReferentArray(r, count);
    for (let i = 0; i < count; i++) {
      const c = instances.get(childRefs[i]);
      if (!c) continue;
      c.parentRef = parentRefs[i];
      const p = instances.get(parentRefs[i]);
      if (p) p.children.push(c);
    }
  }

  const roots = [];
  for (const inst of instances.values()) {
    if (inst.parentRef === null || !instances.has(inst.parentRef)) {
      roots.push(inst);
    }
  }

  REF = 0;
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n`;
  xml += `  <External>null</External>\n`;
  xml += `  <External>nil</External>\n`;
  for (const root of roots) xml += emitItem(root, 1);
  xml += `</roblox>\n`;
  return xml;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);

    if (body.length < 32) {
      res.status(400).json({ error: "File kosong / terlalu kecil" });
      return;
    }

    const head = body.slice(0, 8).toString("binary");
    if (head !== "<roblox!" && head !== "<roblox ") {
      res.status(400).json({ error: "Bukan binary RBXL/RBXM. Header: " + JSON.stringify(head) });
      return;
    }

    const xml = binaryToXml(body);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"converted.rbxlx\"");
    res.status(200).send(xml);
  } catch (e) {
    console.error("[convert]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
}

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "50mb",
  },
};
