"""Security tests for the panel frontend's HTML rendering.

The panel builds every view as a template literal and assigns it to
``innerHTML``. Zone and schedule names arrive from the backend as bare
``cv.string`` and used to be interpolated unescaped, so stored text could run
as script in a viewer's session.

Two layers here, because they catch different things:

- The BEHAVIOUR of the shared helpers is tested in JavaScript
  (``frontend/test/escape-html.test.mjs``), run through ``node --test``. Python
  cannot meaningfully assert what a browser's HTML parser does with a payload.
- A STATIC AUDIT walks the rendering sources and fails if a known
  user-controlled field is interpolated without a helper. That is the layer
  that catches a NEW unescaped site added later, which a fixed list of
  payloads never would.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "smart_sprinkler_control"
    / "frontend"
)
SRC = FRONTEND / "src"
DIST = FRONTEND / "dist" / "smart-sprinkler-control-panel.js"

# Fields whose values originate outside the panel: stored configuration, state
# attributes or another integration's entity. Any interpolation of one of these
# into markup has to go through escapeHtml (text/attribute) or jsArg (inline
# handler argument).
USER_CONTROLLED = (
    "zone.name",
    "schedule.name",
    "schedule.start_time",
    "data.name",
    "data.start_time",
    "data.flow_rate",
    "data.area_sqft",
    "systemName",
    "weather.weatherEntity",
    "weather.rainDelayUntil",
    "statusText",
    "stat.value",
)

# `${...}` interpolations, non-greedy so each is matched separately.
INTERPOLATION = re.compile(r"\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}")


def _render_sources() -> list[Path]:
    """Return the frontend modules that build markup.

    Outputs:
        list[Path] - every .js module in frontend/src except the stylesheet
        module, which contains CSS text only.
    """
    return [
        p
        for p in sorted(SRC.glob("*.js"))
        # styles.js is CSS text; html.js is the helper itself and its docstring
        # quotes the unsafe patterns on purpose, so scanning it would flag the
        # warning rather than a real call site.
        if p.name not in ("styles.js", "html.js")
    ]


def test_escape_helper_exists_exactly_once():
    """There is ONE shared helper module, not a copy per render file."""
    assert (SRC / "html.js").is_file()

    # Scans ALL of src/, html.js included: the point is that exactly one file
    # defines the helper, so the definer must be in scope.
    definitions = [
        p.name
        for p in sorted(SRC.glob("*.js"))
        if re.search(r"(function|const)\s+escapeHtml", p.read_text(encoding="utf-8"))
    ]
    assert definitions == ["html.js"], f"escapeHtml defined in {definitions}"


@pytest.mark.parametrize("field", USER_CONTROLLED)
def test_user_controlled_fields_are_always_escaped(field):
    """No user-controlled field reaches markup unescaped.

    Scans every interpolation that mentions the field and requires it to be
    wrapped in escapeHtml or jsArg.
    """
    offenders = []
    for path in _render_sources():
        for lineno, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            for expr in INTERPOLATION.findall(line):
                if field not in expr:
                    continue
                if "escapeHtml(" in expr or "jsArg(" in expr:
                    continue
                offenders.append(f"{path.name}:{lineno}: ${{{expr}}}")

    assert not offenders, "unescaped user-controlled interpolation:\n" + "\n".join(
        offenders
    )


def test_no_inline_handler_interpolates_a_quoted_string():
    """No ``onclick="fn('${x}')"`` remains anywhere in the sources.

    That shape cannot be made safe with escapeHtml: an HTML attribute is
    entity-decoded before its contents are compiled as JavaScript, so `&#39;`
    becomes `'` again and closes the literal. Those call sites must use jsArg
    and supply no quotes of their own.
    """
    pattern = re.compile(r"on\w+\s*=\s*\"[^\"]*\(\s*'\$\{")
    offenders = []
    for path in _render_sources():
        for lineno, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if pattern.search(line):
                offenders.append(f"{path.name}:{lineno}: {line.strip()[:90]}")

    assert (
        not offenders
    ), "quoted interpolation inside an inline handler:\n" + "\n".join(offenders)


def test_every_render_module_imports_the_helper():
    """A module that interpolates into markup imports the shared helper."""
    missing = []
    for path in _render_sources():
        text = path.read_text(encoding="utf-8")
        if path.name == "constants.js":
            continue
        uses = "escapeHtml(" in text or "jsArg(" in text
        imports = "from './html.js'" in text
        if uses and not imports:
            missing.append(path.name)
    assert not missing, f"uses the helper without importing it: {missing}"


def test_built_bundle_is_current():
    """The committed bundle contains the escaping, i.e. it was rebuilt.

    The panel is served from dist/, so a source-only fix ships nothing. This
    fails if someone edits src/ and forgets `npm run build`.
    """
    assert DIST.is_file()
    bundle = DIST.read_text(encoding="utf-8")

    assert "function escapeHtml" in bundle
    assert "function jsArg" in bundle
    # The pre-fix bundle interpolated these raw.
    assert "runScheduleNow('" not in bundle
    assert "deleteSchedule('" not in bundle


def test_escape_helper_behaviour_via_node():
    """Run the JavaScript test suite for the helpers.

    Skipped (not passed) when node is unavailable: an environment that cannot
    evaluate this must say so rather than report success.
    """
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available; cannot evaluate the JS helper behaviour")

    result = subprocess.run(  # noqa: S603 - fixed argv, no shell
        [node, "--test", "test/"],
        cwd=FRONTEND,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert (
        result.returncode == 0
    ), f"node --test failed:\n{result.stdout[-4000:]}\n{result.stderr[-2000:]}"
    assert "# fail 0" in result.stdout or "fail 0" in result.stdout
