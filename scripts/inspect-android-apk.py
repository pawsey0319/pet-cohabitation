"""Read-only APK identity/resource/certificate and accidental-secret inspection.

Uses the isolated pyaxmlparser installation; never extracts an APK, downloads
artifacts, prints API keys/tokens/key material, or treats certificate extraction
as cryptographic signature verification. Old APKs must use --not-candidate.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
from pathlib import Path
import re
import sys
import warnings
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ANDROID = "{http://schemas.android.com/apk/res/android}"
CERTIFICATE_SHA256 = "7B:A5:D7:1C:7E:80:96:BA:E6:85:3F:EB:41:1A:A3:80:CC:5F:8C:87:42:8A:C8:C8:76:E0:2B:88:8B:05:9D:56"
JWT = re.compile(rb"(?<![A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]{5,2048})\.([A-Za-z0-9_-]{8,32768})\.([A-Za-z0-9_-]{16,8192})(?![A-Za-z0-9_-])")
PRIVATE_MARKER = re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")
PRIVATE_BLOCK = re.compile(rb"-----BEGIN (?P<kind>(?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----[\s\\nr]*(?P<data>[A-Za-z0-9+/=\s\\nr]{64,32768})-----END (?P=kind)-----")
SERVICE_TYPE = re.compile(rb'"type"\s*:\s*"service_account"')
SERVICE_EMAIL = re.compile(rb'"client_email"\s*:\s*"[^"\s]+@[^"\s]+\.gserviceaccount\.com"')
SERVICE_KEY_ID = re.compile(rb'"private_key_id"\s*:\s*"[a-fA-F0-9]{32,128}"')
SERVER_SECRET = re.compile(rb"(?<![A-Za-z0-9_-])sb_secret_[A-Za-z0-9_-]{20,256}(?![A-Za-z0-9_-])")


def fingerprint(data: bytes) -> str:
    return ":".join(f"{byte:02X}" for byte in hashlib.sha256(data).digest())


def b64url(value: bytes) -> bytes:
    return base64.urlsafe_b64decode(value + b"=" * (-len(value) % 4))


def scan_window(data: bytes) -> set[str]:
    """Return detection types only. No matched values can reach the report."""
    findings: set[str] = set()
    for view in (data, data.replace(b"\x00", b"")):
        normalized = view.replace(b'\\"', b'"')
        if PRIVATE_MARKER.search(normalized):
            findings.add("private_key_marker")
        for match in PRIVATE_BLOCK.finditer(normalized):
            try:
                body = re.sub(rb"\s", b"", match["data"].replace(b"\\n", b"").replace(b"\\r", b""))
                decoded = base64.b64decode(body, validate=True)
                if len(decoded) >= 48:
                    findings.add("private_key_block")
            except (ValueError, TypeError):
                pass
        if SERVICE_TYPE.search(normalized) and SERVICE_EMAIL.search(normalized) and SERVICE_KEY_ID.search(normalized):
            findings.add("service_account_json_features")
        if SERVER_SECRET.search(normalized):
            findings.add("supabase_server_secret_key")
        for match in JWT.finditer(normalized):
            try:
                header, payload = json.loads(b64url(match[1])), json.loads(b64url(match[2]))
                if isinstance(header, dict) and isinstance(payload, dict) and payload.get("role") == "service_role":
                    findings.add("jwt_role_service_role")
            except (ValueError, TypeError, UnicodeError):
                pass
    return findings


def scan_archive(path: Path) -> dict:
    findings = []
    scanned_entries = scanned_bytes = 0
    nested_archives = []
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            if entry.flag_bits & 1:
                raise ValueError("encrypted_zip_entry_cannot_be_inspected")
            types: set[str] = set()
            carry = b""
            with archive.open(entry) as stream:
                first = True
                while chunk := stream.read(1024 * 1024):
                    if first and chunk.startswith(b"PK\x03\x04"):
                        nested_archives.append(entry.filename)
                    first = False
                    scanned_bytes += len(chunk)
                    window = carry + chunk
                    types.update(scan_window(window))
                    carry = window[-65536:]
            scanned_entries += 1
            # Entry names and detection classes are safe; snippets are never emitted.
            findings.extend({"entry": entry.filename, "kind": kind} for kind in sorted(types))
    return {
        "complete": True,
        "scanned_entries": scanned_entries,
        "scanned_uncompressed_bytes": scanned_bytes,
        "findings": findings,
        "nested_zip_entries_not_recursively_expanded": nested_archives,
        "scope": "Scanned decompressed APK ZIP-entry bytes and NUL-stripped string views for decoded service_role JWTs, server secret keys, private-key PEM markers/blocks and service-account JSON features. Plain service_role words and public certificates are allowed. Does not prove absence of encrypted/obfuscated secrets or replace code review.",
    }


def resource_string(resources, package: str, name: str) -> str | None:
    value = resources.get_string(package, name)
    return resolve_resource(resources, package, value[1]) if value else None


def resolve_resource(resources, package: str, raw, seen=None) -> str | None:
    if raw is None:
        return None
    value = str(raw)
    if not value.startswith("@"):
        return value
    seen = set() if seen is None else seen
    if value in seen:
        raise ValueError("cyclic_android_resource")
    seen.add(value)
    if value.startswith("@string/"):
        entry = resources.get_string(package, value.split("/", 1)[1])
        return resolve_resource(resources, package, entry[1], seen) if entry else None
    try:
        resource_id = int(value.lstrip("@").removeprefix("0x"), 16)
    except ValueError:
        raise ValueError("unsupported_android_resource_reference") from None
    resolved = resources.get_resolved_res_configs(resource_id)
    values = {resolve_resource(resources, package, entry[1], set(seen)) for entry in resolved}
    values.discard(None)
    if len(values) != 1:
        raise ValueError("missing_or_ambiguous_android_resource")
    return values.pop()


def uses_adjust_resize(value: str | None) -> bool:
    if value is None:
        return False
    try:
        mode = int(value, 16 if value.lower().startswith("0x") else 10)
        # Android SOFT_INPUT_MASK_ADJUST=0xf0; state flags occupy the low bits.
        return mode & 0xF0 == 0x10
    except ValueError:
        adjust = {part.strip() for part in value.split("|") if part.strip().startswith("adjust")}
        return adjust == {"adjustResize"}


def native_manifest_configuration(manifest, package: str) -> dict:
    actions = sorted({node.get(ANDROID + "name") for node in manifest.findall("queries/intent/action") if node.get(ANDROID + "name")})
    application = manifest.find("application")
    launchers = []
    def canonical(name):
        if not name:
            return None
        return package + name if name.startswith(".") else package + "." + name if "." not in name else name
    if application is not None:
        activities = {canonical(node.get(ANDROID + "name")): node for node in application.findall("activity")}
        for node in [*application.findall("activity"), *application.findall("activity-alias")]:
            launcher = any(
                any(action.get(ANDROID + "name") == "android.intent.action.MAIN" for action in intent.findall("action"))
                and any(category.get(ANDROID + "name") == "android.intent.category.LAUNCHER" for category in intent.findall("category"))
                for intent in node.findall("intent-filter")
            )
            if not launcher:
                continue
            name = canonical(node.get(ANDROID + "name"))
            target_name = canonical(node.get(ANDROID + "targetActivity")) if node.tag == "activity-alias" else name
            target = activities.get(target_name)
            raw_mode = target.get(ANDROID + "windowSoftInputMode") if target is not None else None
            theme = target.get(ANDROID + "theme") if target is not None else None
            launchers.append({
                "launcher_name": name, "activity_name": target_name, "activity_found": target is not None,
                "window_soft_input_mode": raw_mode, "adjust_resize": uses_adjust_resize(raw_mode),
                "theme_reference": theme or application.get(ANDROID + "theme"),
            })
    return {
        "query_actions": actions,
        "recognition_service_query": "android.speech.RecognitionService" in actions,
        "tts_service_query": "android.intent.action.TTS_SERVICE" in actions,
        "launcher_activities": launchers,
        "all_launcher_activities_adjust_resize": bool(launchers) and all(item["adjust_resize"] for item in launchers),
    }


def resource_reference_evidence(resources, package: str, reference, apk_files: set[str], style_items=True) -> dict:
    """Record resource identities and archive membership, never visual quality."""
    result = {"reference": reference, "resource_exists": False, "packaged_files": []}
    if not reference:
        return result
    try:
        raw = str(reference).lstrip("@")
        if raw.startswith("android:"):
            return {**result, "framework_reference": True, "local_existence_applicable": False}
        if "/" in raw:
            kind, name = raw.split("/", 1)
            resource_id = resources.get_res_id_by_key(package, kind, name)
        else:
            resource_id = int(raw.removeprefix("0x"), 16)
        if resource_id is None:
            return result
        configurations = resources.get_res_configs(resource_id)
        result.update({"resource_id": f"0x{resource_id:08x}", "resource_name": resources.get_resource_xml_name(resource_id, package), "resource_exists": bool(configurations)})
        files = set()
        def visit(value):
            if isinstance(value, tuple) and len(value) == 2:
                visit(value[1])
            elif isinstance(value, list):
                for child in value:
                    visit(child)
            elif isinstance(value, str) and value.startswith("res/"):
                files.add(value)
        visit(resources.get_resolved_res_configs(resource_id))
        result["packaged_files"] = [{"path": name, "exists": name in apk_files} for name in sorted(files)]
        if style_items and str(result.get("resource_name", "")).startswith("@style/"):
            from pyaxmlparser.resources.public import SYSTEM_RESOURCES
            framework_attributes = SYSTEM_RESOURCES["attributes"]["inverse"]
            references = []
            for config, entry in configurations:
                if not entry.is_complex():
                    continue
                for attr_id, value in entry.item.items:
                    framework_name = framework_attributes.get(attr_id)
                    attribute = resources.get_resource_xml_name(attr_id, package) or (f"@android:attr/{framework_name}" if framework_name else f"0x{attr_id:08x}")
                    if value.is_reference():
                        references.append({"configuration": config.get_qualifier() or "default", "attribute": attribute, "target": resource_reference_evidence(resources, package, f"@{value.get_data():08x}", apk_files, style_items=False)})
            result["declared_launch_style_references"] = references
    except (AttributeError, IndexError, KeyError, TypeError, ValueError, RecursionError) as error:
        result["optional_reference_parse_error"] = type(error).__name__
    return result


def desktop_manifest_configuration(manifest) -> dict:
    services = {node.get(ANDROID + "name"): node for node in manifest.findall("application/service")}
    overlay = services.get("expo.modules.petdesktop.PetDesktopService")
    headless = services.get("expo.modules.petdesktop.PetDesktopTaskService")
    raw_type = overlay.get(ANDROID + "foregroundServiceType", "") if overlay is not None else ""
    try:
        special_only = int(raw_type, 0) == 0x40000000
    except ValueError:
        special_only = raw_type == "specialUse"
    subtype = overlay.find("property[@" + ANDROID + "name='android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE']") if overlay is not None else None
    return {
        "overlay_service_declared": overlay is not None,
        "overlay_service_not_exported": overlay is not None and overlay.get(ANDROID + "exported") in ("false", "0", "0x0"),
        "overlay_special_use_only": special_only,
        "overlay_special_use_description": subtype is not None and bool(subtype.get(ANDROID + "value")),
        "headless_task_not_exported": headless is not None and headless.get(ANDROID + "exported") in ("false", "0", "0x0"),
        "overlay_survives_task_close": overlay is not None and overlay.get(ANDROID + "stopWithTask") in ("false", "0", "0x0"),
    }


def inspect(path: Path, args) -> dict:
    tools = Path(args.tools_dir).resolve()
    if not (tools / "pyaxmlparser").is_dir():
        raise ValueError("isolated_pyaxmlparser_installation_missing")
    sys.path.insert(0, str(tools))
    # Parser diagnostics may include arbitrary resource values; never echo them.
    logging.disable(logging.CRITICAL)
    diagnostics = io.StringIO()
    with warnings.catch_warnings(), redirect_stdout(diagnostics), redirect_stderr(diagnostics):
        warnings.simplefilter("ignore")
        from pyaxmlparser import APK
        apk = APK(str(path))
        if not apk.is_valid_APK():
            raise ValueError("invalid_apk_manifest")
        package = apk.get_package()
        resources = apk.get_android_resources()
        if resources is None:
            raise ValueError("android_resources_missing")
        manifest = apk.get_android_manifest_xml()
        metadata = {}
        for node in manifest.findall("application/meta-data"):
            name = node.get(ANDROID + "name")
            if name in {
                "expo.modules.updates.EXPO_RUNTIME_VERSION",
                "expo.modules.updates.EXPO_UPDATE_URL",
                "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY",
            }:
                metadata[name] = resolve_resource(resources, package, node.get(ANDROID + "value") or node.get(ANDROID + "resource"))
        raw_headers = metadata.get("expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY")
        headers = json.loads(raw_headers) if raw_headers else {}
        permissions = set(apk.get_permissions())
        certs = sorted({fingerprint(certificate.dump()) for certificate in apk.get_certificates()})
        signing_schemes = {"v1": apk.is_signed_v1(), "v2": apk.is_signed_v2(), "v3": apk.is_signed_v3()}
        native_configuration = native_manifest_configuration(manifest, package)
        apk_files = set(apk.get_files())
        application = manifest.find("application")
        brand_resources = {
            "launcher_themes": [{"activity_name": item["activity_name"], **resource_reference_evidence(resources, package, item["theme_reference"], apk_files)} for item in native_configuration["launcher_activities"]],
            "application_icons": {name: resource_reference_evidence(resources, package, application.get(ANDROID + name) if application is not None else None, apk_files) for name in ["icon", "roundIcon"]},
            "scope": "Manifest launch-theme/icon references, declared splash-style references and resolved ZIP-file membership only. Does not verify branding appearance, light/dark transition, cold-start behavior or absence of a startup flash.",
        }
        actual = {
            "package": package,
            "version_name": resolve_resource(resources, package, apk.get_androidversion_name()),
            "version_code": int(apk.get_androidversion_code()),
            "runtime_version": metadata.get("expo.modules.updates.EXPO_RUNTIME_VERSION"),
            "updates_url": metadata.get("expo.modules.updates.EXPO_UPDATE_URL"),
            "updates_channel": headers.get("expo-channel-name"),
            "fcm_application_id": resource_string(resources, package, "google_app_id"),
            "fcm_project_number": resource_string(resources, package, "gcm_defaultSenderId"),
            "fcm_project_id": resource_string(resources, package, "project_id"),
            "firebase_client_api_key_present": bool(resources.get_string(package, "google_api_key")),
            "signing_certificate_sha256": certs,
            "signing_schemes_present": signing_schemes,
            "native_manifest": native_configuration,
            "launch_resource_evidence": brand_resources,
        }
    expected = {
        "package": args.expected_package,
        "version_name": args.expected_version_name,
        "version_code": args.expected_version_code,
        "runtime_version": args.expected_runtime,
        "updates_url": args.expected_updates_url,
        "updates_channel": "preview",
        "fcm_application_id": args.expected_fcm_application_id,
        "fcm_project_number": args.expected_fcm_project_number,
        "fcm_project_id": args.expected_fcm_project_id,
        "signing_certificate_sha256": [args.expected_certificate.upper()],
    }
    checks = [{"name": name, "passed": actual[name] == value, "expected": value, "actual": actual[name]} for name, value in expected.items()]
    required = ["POST_NOTIFICATIONS", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MEDIA_PLAYBACK"]
    if args.require_desktop_pet:
        required.extend(["SYSTEM_ALERT_WINDOW", "FOREGROUND_SERVICE_SPECIAL_USE", "WAKE_LOCK"])
        actual["desktop_manifest"] = desktop_manifest_configuration(manifest)
        checks.extend({"name": name, "passed": value, "expected": True, "actual": value} for name, value in actual["desktop_manifest"].items())
    actual["required_permissions"] = {name: f"android.permission.{name}" in permissions for name in required}
    checks.extend({"name": f"permission_{name}", "passed": present, "expected": True, "actual": present} for name, present in actual["required_permissions"].items())
    checks.append({"name": "apk_signing_block_present", "passed": any(signing_schemes.values()), "expected": True, "actual": any(signing_schemes.values())})
    for name in ["recognition_service_query", "tts_service_query", "all_launcher_activities_adjust_resize"]:
        checks.append({"name": name, "passed": native_configuration[name], "expected": True, "actual": native_configuration[name]})
    scan = scan_archive(path)
    checks.append({"name": "no_detected_server_credentials_or_private_key_markers", "passed": not scan["findings"], "finding_count": len(scan["findings"])})
    checks.append({"name": "no_uninspected_nested_zip_payloads", "passed": not scan["nested_zip_entries_not_recursively_expanded"]})
    with path.open("rb") as source:
        apk_hash = hashlib.file_digest(source, "sha256").hexdigest()
    passed = all(check["passed"] for check in checks)
    return {
        "inspected_at": datetime.now(timezone.utc).isoformat(),
        "apk": str(path), "apk_bytes": path.stat().st_size, "apk_sha256": apk_hash,
        "artifact_classification": "notcandidate" if args.not_candidate else "candidate",
        "candidate_build_id_label": None if args.not_candidate else args.build_id,
        "inspection_succeeded": True,
        "matches_expected_candidate_configuration": passed,
        "candidate_accepted_by_this_static_check": passed and not args.not_candidate,
        "actual": actual, "checks": checks, "secret_scan": scan,
        "parser": "pyaxmlparser 0.3.31 (isolated installation)",
        "parser_diagnostics_suppressed": bool(diagnostics.getvalue()),
        "limitations": [
            "Signing certificate SHA256 was extracted from APK signing data and compared. pyaxmlparser does not cryptographically verify the APK's content signatures; no apksigner verification is claimed.",
            "A supplied EAS build ID is a caller label, not something proven from AndroidManifest.xml.",
            "Static package/resource/permission checks do not validate notification delivery, microphone runtime grants, physical-device behavior or image quality.",
            "RecognitionService/TTS_SERVICE query declarations do not prove an installed speech/TTS provider exists. adjustResize does not prove correct keyboard behavior, and resource existence does not prove flash-free branded startup.",
        ],
    }


def self_test() -> dict:
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=")
    make_jwt = lambda role: encode({"alg": "HS256", "typ": "JWT"}) + b"." + encode({"role": role, "iss": "synthetic-only"}) + b"." + b"A" * 43
    service_jwt = make_jwt("service_role")
    cases = [
        (b"service_role SUPABASE_SERVICE_ROLE_KEY", set()),
        (make_jwt("anon"), set()),
        (service_jwt, {"jwt_role_service_role"}),
        (service_jwt.decode().encode("utf-16le"), {"jwt_role_service_role"}),
        (b"-----BEGIN CERTIFICATE-----\n" + b"A" * 128 + b"\n-----END CERTIFICATE-----", set()),
        (b"-----BEGIN PRIVATE KEY-----\n" + base64.b64encode(b"synthetic-not-a-real-key" * 4) + b"\n-----END PRIVATE KEY-----", {"private_key_marker", "private_key_block"}),
        (b'{"type":"service_account","client_email":"synthetic@fixture.iam.gserviceaccount.com","private_key_id":"' + b"a" * 40 + b'"}', {"service_account_json_features"}),
        (b"sb_secret_" + b"A" * 32, {"supabase_server_secret_key"}),
    ]
    for index, (data, expected) in enumerate(cases):
        assert scan_window(data) == expected, f"scanner_self_test_{index}_failed"
    resize_cases = [("0x00000010", True), ("0x00000012", True), ("18", True), ("adjustResize|stateHidden", True), (None, False), ("0x20", False), ("adjustPan", False), ("adjustResize|adjustPan", False)]
    for value, expected in resize_cases:
        assert uses_adjust_resize(value) == expected, "soft_input_mode_self_test_failed"
    fixture = ET.fromstring('''<manifest xmlns:android="http://schemas.android.com/apk/res/android"><queries><intent><action android:name="android.speech.RecognitionService"/></intent><intent><action android:name="android.intent.action.TTS_SERVICE"/></intent></queries><application><activity android:name=".MainActivity" android:windowSoftInputMode="0x12"/><activity-alias android:name=".Launcher" android:targetActivity=".MainActivity"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity-alias></application></manifest>''')
    config = native_manifest_configuration(fixture, "example.test")
    assert config["recognition_service_query"] and config["tts_service_query"] and config["all_launcher_activities_adjust_resize"], "manifest_alias_self_test_failed"
    fixture.remove(fixture.find("queries"))
    config = native_manifest_configuration(fixture, "example.test")
    assert not config["recognition_service_query"] and not config["tts_service_query"], "missing_queries_self_test_failed"
    return {"self_test": "passed", "cases": len(cases) + len(resize_cases) + 2, "secret_scanner_cases": len(cases), "native_manifest_cases": len(resize_cases) + 2, "real_credentials_used": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--not-candidate", action="store_true", help="Parser validation against an older APK; can never accept a candidate.")
    parser.add_argument("--build-id", help="Optional caller-supplied EAS candidate label, not proof of provenance.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--require-desktop-pet", action="store_true", help="Require Android overlay/headless service declarations; still not a device acceptance.")
    parser.add_argument("--tools-dir", default=str(ROOT / "test-results" / "apk-inspection-tools"))
    parser.add_argument("--expected-package", default="com.pawsey.petcohabitation")
    parser.add_argument("--expected-version-name", default="1.0.5")
    parser.add_argument("--expected-version-code", type=int, default=6)
    parser.add_argument("--expected-runtime", default="1.0.5")
    parser.add_argument("--expected-updates-url", default="https://u.expo.dev/8cc62f33-fbad-4b84-b0c7-2f579cbc9e37")
    parser.add_argument("--expected-fcm-application-id", default="1:548557314654:android:080de1c1dc66d4d01832cf")
    parser.add_argument("--expected-fcm-project-number", default="548557314654")
    parser.add_argument("--expected-fcm-project-id", default="pet-cohabitation-pawsey")
    parser.add_argument("--expected-certificate", default=CERTIFICATE_SHA256)
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test()))
        return 0
    if not args.apk or not args.output:
        parser.error("--apk and --output are required unless --self-test is used")
    path = args.apk.resolve()
    try:
        if not path.is_file() or not zipfile.is_zipfile(path):
            raise ValueError("apk_file_missing_or_not_zip")
        report = inspect(path, args)
    except Exception as reason:
        # Exception text can contain hostile manifest/resource values. Emit only
        # an exception class and bounded known operational code, never raw text.
        code = str(reason)
        safe_code = code if re.fullmatch(r"[a-z_]{3,80}", code) else "apk_inspection_failed"
        report = {"inspection_succeeded": False, "artifact_classification": "notcandidate" if args.not_candidate else "candidate", "failure_type": type(reason).__name__, "failure_code": safe_code}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not report["inspection_succeeded"]:
        print(json.dumps({"status": "inspection_failed", "failure_type": report["failure_type"], "failure_code": report["failure_code"], "report": str(args.output.resolve())}))
        return 2
    failed = [check["name"] for check in report["checks"] if not check["passed"]]
    print(json.dumps({"status": "notcandidate" if args.not_candidate else "passed" if not failed else "failed", "checks": len(report["checks"]), "failed_checks": failed, "report": str(args.output.resolve())}))
    # Old-package validation permits expected version/permission mismatches but
    # never silently accepts detected secret material or incomplete scanning.
    if args.not_candidate:
        return 1 if report["secret_scan"]["findings"] or report["secret_scan"]["nested_zip_entries_not_recursively_expanded"] else 0
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
