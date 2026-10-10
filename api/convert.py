from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import base64

SERVICES = [
    "Workspace", "ReplicatedStorage", "ServerStorage",
    "StarterGui", "StarterPack", "ServerScriptService",
    "Lighting", "SoundService"
]

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._json(200, {"ok": True, "service": "NANG Converter", "status": "running"})

    def do_POST(self):
        try:
            from rbxfile import binary, xml
            from rbxfile.instance import Instance

            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            target = params.get("target", ["Workspace"])[0]
            name = params.get("name", ["Extracted"])[0]
            group = params.get("group", ["1"])[0] == "1"

            length = int(self.headers.get("Content-Length", 0))
            data = self.rfile.read(length)

            if not data or len(data) < 8:
                return self._json(400, {"ok": False, "error": "File kosong"})

            is_binary = data[:8] == b"<roblox!"
            is_xml = data[:64].lstrip().lower().startswith((b"<?xml", b"<roblox"))

            if not is_binary and not is_xml:
                return self._json(400, {"ok": False, "error": "File bukan RBXL/RBXLX"})

            if is_binary:
                dm = binary.deserialize(data)
            else:
                dm = xml.deserialize(data.decode("utf-8", errors="ignore"))

            def find_service(root, svc_name):
                for child in root.get_children():
                    if child.name == svc_name or child.class_name == svc_name:
                        return child
                return None

            targets = SERVICES if target == "All" else [target]
            root_folder = Instance(class_name="Folder")
            root_folder.name = name

            extracted = []
            total_moved = 0

            for svc_name in targets:
                svc = find_service(dm, svc_name)
                if not svc:
                    continue

                container = root_folder
                if group:
                    container = Instance(class_name="Folder")
                    container.name = svc_name
                    container.parent = root_folder

                moved = 0
                for child in list(svc.get_children()):
                    child.parent = container
                    moved += 1

                if moved > 0:
                    extracted.append(f"{svc_name}({moved})")
                    total_moved += moved
                elif group:
                    container.parent = None

            if not extracted:
                return self._json(400, {"ok": False, "error": "Tidak ada object di service tersebut"})

            new_dm = Instance(class_name="DataModel")
            root_folder.parent = new_dm

            out = binary.serialize(new_dm)

            return self._json(200, {
                "ok": True,
                "fileName": f"{name}.rbxm",
                "size": len(out),
                "extracted": extracted,
                "totalObjects": total_moved,
                "grouped": group,
                "file": base64.b64encode(out).decode("ascii")
            })
        except Exception as e:
            import traceback
            return self._json(500, {
                "ok": False,
                "error": str(e),
                "trace": traceback.format_exc()[:400]
            })

    def _json(self, status, obj):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode())
