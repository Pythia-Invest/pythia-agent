"""Compatibility imports for financial workers using shared platform context."""
from ._platform import platform

cancel_signal = platform().request_context.cancel_signal
usage = platform().request_context.usage
dashboard_operation = platform().request_context.dashboard_operation
cancelled = platform().request_context.cancelled
