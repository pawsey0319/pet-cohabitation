"""Measure the locked production processor on an existing synthetic sample.

No cloud credentials, gateway leases, downloads, or production jobs are used.
Each sample starts a fresh child, matching worker.py's per-job isolation.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def peak_rss_bytes():
    if os.name != "nt":
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(peak if sys.platform == "darwin" else peak * 1024)

    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
    values = Counters(); values.cb = ctypes.sizeof(values)
    kernel = ctypes.windll.kernel32
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    query = ctypes.windll.psapi.GetProcessMemoryInfo
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not query(kernel.GetCurrentProcess(), ctypes.byref(values), values.cb):
        raise ctypes.WinError()
    return values.PeakWorkingSetSize


def child(args):
    began = time.perf_counter(); cpu = time.process_time(); phases = {}
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/avatars/transparent-worker"))
    import worker
    phases["worker_import_ms"] = round((time.perf_counter() - began) * 1000, 2)
    start = time.perf_counter()
    import rembg
    phases["rembg_import_ms"] = round((time.perf_counter() - start) * 1000, 2)

    def timed(original, name):
        def wrapped(*positional, **keywords):
            start = time.perf_counter()
            try: return original(*positional, **keywords)
            finally: phases[name] = round((time.perf_counter() - start) * 1000, 2)
        return wrapped
    worker.verify_model = timed(worker.verify_model, "model_checksum_ms")
    rembg.new_session = timed(rembg.new_session, "model_load_ms")
    worker.extract_mask = timed(worker.extract_mask, "two_pass_inference_ms")
    source = args.source.read_bytes()
    output = worker.process(source, args.model_dir)
    args.output.write_bytes(output)
    result = {"phases": phases, "elapsed_ms": round((time.perf_counter() - began) * 1000, 2),
              "cpu_seconds": round(time.process_time() - cpu, 3), "peak_rss_bytes": peak_rss_bytes(),
              "source_sha256": hashlib.sha256(source).hexdigest(), "output_sha256": hashlib.sha256(output).hexdigest(),
              "output_bytes": len(output), "model": worker.LOCK}
    print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--child", action="store_true")
    args = parser.parse_args()
    if args.child: return child(args)
    if not 1 <= args.samples <= 20: raise ValueError("samples must be 1..20")
    args.output.mkdir(parents=True, exist_ok=False)
    report = {"source": str(args.source), "synthetic_only": True, "runtime": sys.version,
              "platform": sys.platform, "samples": [], "scope": "Fresh local child per image; OS disk cache uncontrolled; no cloud CPU/memory equivalence, lease or 24-hour availability claim."}
    env = {key: value for key, value in os.environ.items() if not any(part in key.upper() for part in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "SUPABASE"))}
    for index in range(args.samples):
        start = time.perf_counter()
        process = subprocess.run([sys.executable, __file__, "--child", "--source", str(args.source.resolve()),
                                  "--model-dir", str(args.model_dir.resolve()), "--output", str((args.output / f"sample-{index + 1}.png").resolve())],
                                 env=env, text=True, capture_output=True, timeout=240)
        if process.returncode:
            # Preserve a bounded diagnostic, never model input or credentials.
            raise RuntimeError(f"isolated processor failed ({process.returncode}): {process.stderr[-1000:]}")
        sample = json.loads(process.stdout)
        sample["end_to_end_child_ms"] = round((time.perf_counter() - start) * 1000, 2)
        sample["sample"] = index + 1
        report["samples"].append(sample)
        (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({key: sample[key] for key in ("sample", "end_to_end_child_ms", "peak_rss_bytes", "phases")}), flush=True)


if __name__ == "__main__": main()
