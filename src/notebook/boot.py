# Runs inside Pyodide (the browser kernel) once, before the first cell.
# Gives cells Jupyter-like behaviour: printed output, rich display of the last
# expression, display()/IPython.display, inline matplotlib, %pip install, and
# tracebacks that show only the cell's own lines.
import base64
import builtins
import io
import json
import linecache
import os
import re
import sys
import traceback
import types
import warnings

os.environ.setdefault("MPLBACKEND", "AGG")
warnings.filterwarnings("ignore", message=".*non-interactive.*")
warnings.filterwarnings("ignore", message="The [xy] parameter as float")

from _study import emit  # noqa: E402  (provided by the worker)
from pyodide.code import eval_code_async  # noqa: E402


class _Stream(io.TextIOBase):
    def __init__(self, name):
        self._stream_name = name

    def writable(self):
        return True

    def write(self, s):
        if s:
            emit("stream", json.dumps({"name": self._stream_name, "text": s}))
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False


sys.stdout = _Stream("stdout")
sys.stderr = _Stream("stderr")

_MIMES = (
    ("_repr_html_", "text/html"),
    ("_repr_markdown_", "text/markdown"),
    ("_repr_svg_", "image/svg+xml"),
    ("_repr_png_", "image/png"),
    ("_repr_jpeg_", "image/jpeg"),
    ("_repr_latex_", "text/latex"),
)


def _bundle(obj):
    data = {}
    for meth, mime in _MIMES:
        f = getattr(obj, meth, None)
        if not callable(f):
            continue
        try:
            v = f()
        except Exception:
            continue
        if v is None:
            continue
        if isinstance(v, tuple):
            v = v[0]
        if isinstance(v, (bytes, bytearray)):
            v = base64.b64encode(v).decode("ascii")
        data[mime] = v
    data["text/plain"] = repr(obj)
    return data


def display(*objs, **kwargs):
    for o in objs:
        emit("display", json.dumps(_bundle(o)))


def clear_output(wait=False):
    emit("clear", json.dumps({"wait": bool(wait)}))


builtins.display = display


# A small stand-in for IPython.display, so common notebook code runs.
class HTML:
    def __init__(self, data=""):
        self.data = data

    def _repr_html_(self):
        return self.data


class Markdown:
    def __init__(self, data=""):
        self.data = data

    def _repr_markdown_(self):
        return self.data


class Latex:
    def __init__(self, data=""):
        self.data = data

    def _repr_latex_(self):
        return self.data


class Math(Latex):
    def _repr_latex_(self):
        return "$$" + self.data.strip("$") + "$$"


class Image:
    def __init__(self, data=None, url=None, filename=None, format=None, **kwargs):
        if filename:
            with open(filename, "rb") as fh:
                data = fh.read()
        self.data = data
        self.format = (format or (filename or "").rsplit(".", 1)[-1] or "png").lower()

    def _repr_png_(self):
        return self.data if self.format == "png" else None

    def _repr_jpeg_(self):
        return self.data if self.format in ("jpg", "jpeg") else None


_display_mod = types.ModuleType("IPython.display")
for _name, _obj in dict(
    display=display, clear_output=clear_output, HTML=HTML, Markdown=Markdown, Latex=Latex, Math=Math, Image=Image
).items():
    setattr(_display_mod, _name, _obj)
_ipython_mod = types.ModuleType("IPython")
_ipython_mod.display = _display_mod
# Libraries (matplotlib, pandas) probe IPython this way; "no shell" is the right answer.
_ipython_mod.get_ipython = lambda: None
_ipython_mod.version_info = (8, 0, 0)
_ipython_mod.__version__ = "8.0.0"
sys.modules.setdefault("IPython", _ipython_mod)
sys.modules.setdefault("IPython.display", _display_mod)


def _flush_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
        emit(
            "display",
            json.dumps({"image/png": base64.b64encode(buf.getvalue()).decode("ascii"), "text/plain": "<Figure>"}),
        )
    plt.close("all")


def _patch_show():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is not None and getattr(plt.show, "__name__", "") != "_study_show":

        def _study_show(*args, **kwargs):
            _flush_figures()

        plt.show = _study_show


_ns = {"__name__": "__main__", "display": display}
_PIP = re.compile(r"^\s*[%!]pip\s+install\s+(.+)$")


async def _study_run(code):
    lines = []
    for line in code.split("\n"):
        m = _PIP.match(line)
        if m:
            import pyodide_js

            await pyodide_js.loadPackage("micropip")
            import micropip

            pkgs = [p for p in m.group(1).split() if not p.startswith("-")]
            print("Installing " + ", ".join(pkgs) + " ...")
            await micropip.install(pkgs)
            print("Installed.")
            continue
        stripped = line.strip()
        if stripped.startswith(("%", "!")):
            print("Not available in the browser kernel: " + stripped.split()[0], file=sys.stderr)
            continue
        lines.append(line)
    src = "\n".join(lines)
    linecache.cache["<cell>"] = (len(src), None, src.splitlines(True), "<cell>")
    # Import pyplot up front when the cell uses matplotlib, so plt.show() shows
    # the figure where it is called (not after the cell's result).
    if "matplotlib" in src and "matplotlib.pyplot" not in sys.modules:
        try:
            import matplotlib.pyplot  # noqa: F401
        except Exception:
            pass
    _patch_show()
    try:
        result = await eval_code_async(src, _ns, filename="<cell>")
        _patch_show()
        if result is not None:
            _ns["_"] = result
            emit("result", json.dumps(_bundle(result)))
        _flush_figures()
        return True
    except BaseException as e:  # noqa: BLE001 - report everything, like Jupyter does
        _flush_figures()
        frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == "<cell>"]
        tb = []
        if frames:
            tb.append("Traceback (most recent call last):")
            tb += [line.rstrip("\n") for line in traceback.format_list(frames)]
        tb += [line.rstrip("\n") for line in traceback.format_exception_only(type(e), e)]
        emit("error", json.dumps({"ename": type(e).__name__, "evalue": str(e), "traceback": tb}))
        return False
