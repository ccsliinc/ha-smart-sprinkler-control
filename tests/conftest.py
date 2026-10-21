"""Shared fixtures for the tests that need a real Home Assistant instance.

Most tests in this directory import a source file directly with importlib and
need no running Home Assistant. The security tests DO need the real harness -
an HTTP client, a user with and without admin rights, a live service registry -
which ``pytest-homeassistant-custom-component`` provides (it registers itself
as a pytest plugin automatically).
"""

import pytest


@pytest.fixture(scope="session", autouse=True)
def _warm_pycares_shutdown_thread():
    """Start pycares' shutdown thread before any per-test thread snapshot.

    Description:
        Home Assistant's ``verify_cleanup`` fixture fails a test if any new
        thread survives it. ``aiohttp``'s client resolves DNS through
        ``aiodns``/``pycares``, and pycares starts a single daemon
        ``_run_safe_shutdown_loop`` thread LAZILY, when the first channel is
        destroyed - which happens during the teardown of the first test that
        builds an HTTP client. The thread is a process-wide singleton and is
        never going to be cleaned up, so the only test it can ever fail is
        whichever one happens to create the first client.

        Starting it here, once, before any test takes its "threads before"
        snapshot, removes that ordering artifact. It is deliberately tolerant:
        if pycares is absent or renames its internals, the suite carries on and
        at worst the original artifact returns.
    Inputs:
        None.
    Outputs:
        None.
    """
    try:
        import pycares

        pycares._shutdown_manager.start()
    except (ImportError, AttributeError):  # pragma: no cover - env dependent
        pass


@pytest.fixture
def ssc_custom_integration(enable_custom_integrations):
    """Allow Home Assistant to load this repo's custom integration.

    Description:
        Thin alias for the upstream ``enable_custom_integrations`` fixture, so
        the intent reads clearly at the call site and only the tests that need
        a real integration setup pay for it.
    Inputs:
        enable_custom_integrations: fixture from
            pytest-homeassistant-custom-component.
    Outputs:
        None.
    """
    return
