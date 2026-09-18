"""Trusted cancellation and usage shared across native operation workers."""
from contextvars import ContextVar
from functools import wraps

cancel_signal = ContextVar("pythia_operation_cancel", default=None)
usage = ContextVar('pythia_operation_usage', default='research')
read_only_required = ContextVar('pythia_operation_read_only_required', default=False)


def dashboard_operation(function):
    """Trusted transport scope; never accepted from tool or HTTP arguments."""
    @wraps(function)
    def call(*args, **kwargs):
        token = usage.set('dashboard')
        try: return function(*args, **kwargs)
        finally: usage.reset(token)
    return call


def cancelled():
    callback = cancel_signal.get()
    return bool(callback and callback())
