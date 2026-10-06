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
    if (litLen === 15) { let b; do { b = input[ip++]; litLen += b; } while (b === 255); }
    for (let i = 0; i < litLen; i++) out[op++] = input[ip++];
    if (op >= expectedSize) break;
    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;
    if (matchLen === 19) { let b; do { b = input[ip++]; matchLen += b; } while (b === 255); }
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
  const validNames = new Set(["META","SSTR","INST","PROP","PRNT","SIGN","END\u0000"]);

  while (off + 16 <= buf.length) {
    const name = buf.slice(off, off + 4).toString("binary");
    off += 4;
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
      try {
        if (magic === ZSTD_MAGIC) data = Buffer.from(zstdDecompress(slice));
        else data = lz4DecompressBlock(slice, decompLen);
      } catch (e) {
        console.warn("[convert] decompress fail for", name, e.message);
        data = Buffer.alloc(0);
      }
    }

    if (!validNames.has(name)) {
      if (name === "END\u0000") break;
      continue;
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
  i16be() { const v = this.buf.readInt16BE(this.off); this.off += 2; return v; }
  bytes(n) { const s = this.buf.slice(this.off, this.off + n); this.off += n; return s; }
  skip(n) { this.off += n; }
  // F32: BE u32, rotate right by 1, interpret as float
  f32() {
    const raw = this.buf.readUInt32BE(this.off);
    this.off += 4;
    const rotated = ((raw >>> 1) | ((raw & 1) << 31)) >>> 0;
    const tmp = Buffer.alloc(4);
    tmp.writeUInt32BE(rotated);
    return tmp.readFloatBE(0);
  }
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
    for (let s = 0; s < size; s++) out[i * size + s] = raw[s * count + i];
  }
  return out;
}

function zigzag(v) { return (v % 2 === 0) ? v / 2 : -(v + 1) / 2; }

function readI32Array(reader, count) {
  if (count <= 0) return [];
  const raw = reader.bytes(count * 4);
  const buf = deinterleave(raw, count, 4);
  const out = [];
  for (let i = 0; i < count; i++) out.push(zigzag(buf.readUInt32BE(i * 4)));
  return out;
}

function readF32Array(reader, count) {
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

function readRefArray(reader, count) {
  if (count <= 0) return [];
  const deltas = readI32Array(reader, count);
  const out = [];
  let last = 0;
  for (const d of deltas) { last += d; out.push(last); }
  return out;
}

function decodeINST(chunkBuf) {
  const r = new Reader(chunkBuf);
  const classId = r.u32();
  const className = r.string();
  const isService = r.u8() === 1;
  const count = r.u32();
  const refs = readRefArray(r, count);
  return { classId, className, isService, refs };
}

// Read values for a given property type. Return array of values, or throw on unknown.
function readPropertyValues(r, typeByte, count) {
  const values = [];
  switch (typeByte) {
    case 0x01: case 0x1D:
      for (let i = 0; i < count; i++) values.push(r.string());
      return values;
    case 0x02:
      for (let i = 0; i < count; i++) values.push(r.u8() !== 0);
      return values;
    case 0x03: return readI32Array(r, count);
    case 0x04: return readF32Array(r, count);
    case 0x05:
      for (let i = 0; i < count; i++) values.push(r.f64le());
      return values;
    case 0x06: // UDim
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32()]);
      return values;
    case 0x07: // UDim2
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32(), r.f32(), r.f32()]);
      return values;
    case 0x08: // Ray
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32()]);
      return values;
    case 0x09: case 0x0A: // Faces, Axes
      for (let i = 0; i < count; i++) values.push(r.u8());
      return values;
    case 0x0B: // BrickColor
      for (let i = 0; i < count; i++) values.push(r.u32());
      return values;
    case 0x0C: // Color3 (3 floats)
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32(), r.f32()]);
      return values;
    case 0x0D: // Vector2
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32()]);
      return values;
    case 0x0E: // Vector3
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32(), r.f32()]);
      return values;
    case 0x0F: // Vector2int16
      for (let i = 0; i < count; i++) values.push([r.i16be(), r.i16be()]);
      return values;
    case 0x10: // CFrame (12 floats)
      for (let i = 0; i < count; i++) {
        const arr = [];
        for (let k = 0; k < 12; k++) arr.push(r.f32());
        values.push(arr);
      }
      return values;
    case 0x11: // Quaternion (4 floats)
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32(), r.f32(), r.f32()]);
      return values;
    case 0x12: // Enum
      for (let i = 0; i < count; i++) values.push(r.u32());
      return values;
    case 0x13: return readRefArray(r, count);
    case 0x14: // Vector3int16
      for (let i = 0; i < count; i++) values.push([r.i16be(), r.i16be(), r.i16be()]);
      return values;
    case 0x15: { // NumberSequence
      for (let i = 0; i < count; i++) {
        const has = r.u8();
        if (!has) { values.push(null); continue; }
        const kc = r.u32();
        const kfs = [];
        for (let k = 0; k < kc; k++) kfs.push([r.f32(), r.f32(), r.f32()]);
        values.push(kfs);
      }
      return values;
    }
    case 0x16: { // ColorSequence
      for (let i = 0; i < count; i++) {
        const has = r.u8();
        if (!has) { values.push(null); continue; }
        const kc = r.u32();
        const kfs = [];
        for (let k = 0; k < kc; k++) {
          const t = r.f32();
          const rr = r.u8(); const gg = r.u8(); const bb = r.u8(); const aa = r.u8();
          kfs.push([t, rr, gg, bb, aa]);
        }
        values.push(kfs);
      }
      return values;
    }
    case 0x17: // NumberRange
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32()]);
      return values;
    case 0x18: // Rect
      for (let i = 0; i < count; i++) values.push([r.f32(), r.f32(), r.f32(), r.f32()]);
      return values;
    case 0x19: // PhysicalProperties
      for (let i = 0; i < count; i++) {
        const has = r.u8();
        if (!has) { values.push(null); continue; }
        values.push([r.f32(), r.f32(), r.f32(), r.f32(), r.f32()]);
      }
      return values;
    case 0x1A: // Color3uint8
      for (let i = 0; i < count; i++) values.push([r.u8(), r.u8(), r.u8()]);
      return values;
    case 0x1B: // Int64
      for (let i = 0; i < count; i++) {
        const lo = r.u32();
        const hi = r.u32();
        values.push(hi * 4294967296 + lo);
      }
      return values;
    case 0x1C: // SharedString
      for (let i = 0; i < count; i++) values.push(r.u32());
      return values;
    default:
      throw new Error("unknown type 0x" + typeByte.toString(16));
  }
}

function decodePROP(chunkBuf, classDefs) {
  const r = new Reader(chunkBuf);
  const classId = r.u32();
  const classDef = classDefs[classId];
  if (!classDef) throw new Error("unknown class id " + classId);
  const sizeof = classDef.refs.length;
  const propName = r.string();
  // 0x1E marker — peeking
  if (r.buf[r.off] === 0x1E) r.off += 1;
  const typeByte = r.u8();
  const props = readPropertyValues(r, typeByte, sizeof);
  return { classId, refs: classDef.refs, propName, typeByte, props };
}

function esc(s) {
  if (typeof s !== "string") return String(s);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

let REF = 0;
function nextRef() { return "RBX" + (REF++).toString(36).toUpperCase(); }

function emitProperty(name, typeByte, value) {
  if (value === null || value === undefined) return "";
  const n = esc(name);
  switch (typeByte) {
    case 0x01: case 0x1D:
      if (name === "Source" || name === "ContentText") {
        return `<ProtectedString name="${n}"><![CDATA[${value}]]></ProtectedString>`;
      }
      return `<string name="${n}">${esc(value)}</string>`;
    case 0x02: return `<bool name="${n}">${value ? "true" : "false"}</bool>`;
    case 0x03: return `<int name="${n}">${value}</int>`;
    case 0x04: return `<float name="${n}">${value}</float>`;
    case 0x05: return `<double name="${n}">${value}</double>`;
    case 0x06: { const [s, o] = value; return `<UDim name="${n}"><S>${s}</S><O>${o}</O></UDim>`; }
    case 0x07: { const [xs, xo, ys, yo] = value; return `<UDim2 name="${n}"><XS>${xs}</XS><XO>${xo}</XO><YS>${ys}</YS><YO>${yo}</YO></UDim2>`; }
    case 0x08: { const [ox, oy, oz, dx, dy, dz] = value; return `<Ray name="${n}"><Origin><X>${ox}</X><Y>${oy}</Y><Z>${oz}</Z></Origin><Direction><X>${dx}</X><Y>${dy}</Y><Z>${dz}</Z></Direction></Ray>`; }
    case 0x09: return `<Faces name="${n}">${value}</Faces>`;
    case 0x0A: return `<Axes name="${n}">${value}</Axes>`;
    case 0x0B: return `<BrickColor name="${n}">${value}</BrickColor>`;
    case 0x0C: { const [rr, gg, bb] = value; return `<Color3 name="${n}"><R>${rr}</R><G>${gg}</G><B>${bb}</B></Color3>`; }
    case 0x0D: { const [x, y] = value; return `<Vector2 name="${n}"><X>${x}</X><Y>${y}</Y></Vector2>`; }
    case 0x0E: { const [x, y, z] = value; return `<Vector3 name="${n}"><X>${x}</X><Y>${y}</Y><Z>${z}</Z></Vector3>`; }
    case 0x0F: { const [x, y] = value; return `<Vector2int16 name="${n}"><X>${x}</X><Y>${y}</Y></Vector2int16>`; }
    case 0x10: {
      const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = value;
      return `<CoordinateFrame name="${n}"><X>${x}</X><Y>${y}</Y><Z>${z}</Z>` +
        `<R00>${r00}</R00><R01>${r01}</R01><R02>${r02}</R02>` +
        `<R10>${r10}</R10><R11>${r11}</R11><R12>${r12}</R12>` +
        `<R20>${r20}</R20><R21>${r21}</R21><R22>${r22}</R22></CoordinateFrame>`;
    }
    case 0x11: { const [x, y, z, w] = value; return `<Quaternion name="${n}"><X>${x}</X><Y>${y}</Y><Z>${z}</Z><W>${w}</W></Quaternion>`; }
    case 0x12: return `<token name="${n}">${value}</token>`;
    case 0x13: return `<Ref name="${n}">${value}</Ref>`;
    case 0x14: { const [x, y, z] = value; return `<Vector3int16 name="${n}"><X>${x}</X><Y>${y}</Y><Z>${z}</Z></Vector3int16>`; }
    case 0x15: { // NumberSequence
      if (!Array.isArray(value)) return "";
      let s = `<NumberSequence name="${n}">`;
      for (const kp of value) {
        const [t, v, env] = kp;
        s += `<Keypoint><Time>${t}</Time><Value>${v}</Value><Envelope>${env}</Envelope></Keypoint>`;
      }
      return s + `</NumberSequence>`;
    }
    case 0x16: { // ColorSequence
      if (!Array.isArray(value)) return "";
      let s = `<ColorSequence name="${n}">`;
      for (const kp of value) {
        const [t, rr, gg, bb, aa] = kp;
        s += `<Keypoint><Time>${t}</Time><Color><R>${(rr / 255).toFixed(6)}</R><G>${(gg / 255).toFixed(6)}</G><B>${(bb / 255).toFixed(6)}</B></Color></Keypoint>`;
      }
      return s + `</ColorSequence>`;
    }
    case 0x17: { const [mn, mx] = value; return `<NumberRange name="${n}"><Min>${mn}</Min><Max>${mx}</Max></NumberRange>`; }
    case 0x18: { const [x0, y0, x1, y1] = value; return `<Rect name="${n}"><min><X>${x0}</X><Y>${y0}</Y></min><max><X>${x1}</X><Y>${y1}</Y></max></Rect>`; }
    case 0x19: {
      if (!Array.isArray(value)) return "";
      const [d, f, e, fw, ew] = value;
      return `<PhysicalProperties name="${n}"><CustomPhysics>true</CustomPhysics><Density>${d}</Density><Friction>${f}</Friction><Elasticity>${e}</Elasticity><FrictionWeight>${fw}</FrictionWeight><ElasticityWeight>${ew}</ElasticityWeight></PhysicalProperties>`;
    }
    case 0x1A: { const [rr, gg, bb] = value; return `<Color3uint8 name="${n}">${(rr << 16) | (gg << 8) | bb}</Color3uint8>`; }
    case 0x1B: return `<int64 name="${n}">${value}</int64>`;
    case 0x1C: return `<SharedString name="${n}">${value}</SharedString>`;
    default: return "";
  }
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
    if (!v || typeof v !== "object") continue;
    const line = emitProperty(k, v.type, v.value);
    if (line) out += `${p3}${line}\n`;
  }
  out += `${p2}</Properties>\n`;
  for (const child of node.children || []) out += emitItem(child, indent + 1);
  out += `${pad}</Item>\n`;
  return out;
}

function binaryToXml(buf) {
  const chunks = parseChunks(buf);
  const classDefs = {};
  const instances = new Map();

  for (const ch of chunks) {
    if (ch.name !== "INST") continue;
    try {
      const def = decodeINST(ch.data);
      classDefs[def.classId] = def;
      for (const ref of def.refs) {
        instances.set(ref, { className: def.className, properties: {}, children: [], ref, parentRef: null });
      }
    } catch (e) { console.warn("[convert] INST skip:", e.message); }
  }

  for (const ch of chunks) {
    if (ch.name !== "PROP") continue;
    try {
      const p = decodePROP(ch.data, classDefs);
      for (let i = 0; i < p.refs.length; i++) {
        const inst = instances.get(p.refs[i]);
        if (inst && p.props[i] !== undefined) {
          inst.properties[p.propName] = { type: p.typeByte, value: p.props[i] };
        }
      }
    } catch (e) { console.warn("[convert] PROP skip:", e.message); }
  }

  for (const ch of chunks) {
    if (ch.name !== "PRNT") continue;
    try {
      const r = new Reader(ch.data);
      r.u8();
      const count = r.u32();
      const childRefs = readRefArray(r, count);
      const parentRefs = readRefArray(r, count);
      for (let i = 0; i < count; i++) {
        const c = instances.get(childRefs[i]);
        if (!c) continue;
        c.parentRef = parentRefs[i];
        const p = instances.get(parentRefs[i]);
        if (p) p.children.push(c);
      }
    } catch (e) { console.warn("[convert] PRNT skip:", e.message); }
  }

  const roots = [];
  for (const inst of instances.values()) {
    if (inst.parentRef === null || !instances.has(inst.parentRef)) roots.push(inst);
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
    if (body.length < 32) { res.status(400).json({ error: "File kosong / terlalu kecil" }); return; }
    const head = body.slice(0, 8).toString("binary");
    if (head !== "<roblox!" && head !== "<roblox ") {
      res.status(400).json({ error: "Bukan binary RBXL/RBXM. Header: " + JSON.stringify(head) });
      return;
    }
    const xml = binaryToXml(body);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=\"converted.rbxlx\"; filename*=UTF-8''converted.rbxlx");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(xml);
  } catch (e) {
    console.error("[convert]", e);
    res.status(500).json({ error: String(e.message || e) });
  }
}

export const config = {
  api: { bodyParser: false, sizeLimit: "50mb" },
};
