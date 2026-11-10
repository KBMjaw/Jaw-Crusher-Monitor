"""
conftest.py — pytest configuration
Sets asyncio mode to auto so all async tests work without extra decorators.
"""
# Use asyncio event loop for all async tests automatically
def pytest_configure(config):
    config.addinivalue_line(
        "markers", "asyncio: mark test as async"
    )
