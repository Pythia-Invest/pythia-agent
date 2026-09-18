"""CLI adapter for an explicitly named native read tool owned by its plugin.

This is not an arbitrary tool gateway or another registry. Each provider binds
one command to one of its own read tools; native enablement and platform choices
are checked at invocation, exactly as for common market-data reads.
"""
import json
import signal
import threading

from .contributions import eligible_tools, ContextUnavailable
from .execution import failure, MAX_JSON_BYTES
from .wire import validate_parameters, WireError
from .failures import item_failures


def register_read_command(ctx, command_name, tool_name, description, *, cache_seconds=0, cache_overrides=(), schema=None, plugin=None):
    if schema is not None:
        # A deliberate declaration on the same schema already registered with
        # Hermes; no HTTP handler or security code belongs in the connector.
        comment = json.loads(schema['parameters'].get('$comment', '{}'))
        comment['pythia_http_operation'] = {'operation': command_name, 'plugin': plugin,
                                           'cache_seconds': cache_seconds if type(cache_seconds) is int else 0,
                                           'cache_overrides': list(cache_overrides)}
        schema['parameters']['$comment'] = json.dumps(comment, separators=(',', ':'))
    def setup(parser):
        parser.add_argument('--platform', required=True, choices=['cli', 'api_server'])
        parser.add_argument('--request', required=True, help='Native read arguments as JSON; no credentials')
        parser.add_argument('--reuse-scope', help='Internal conditional reuse of an unexpired caller-held result')

    def command(args):
        from gateway.session_context import set_session_vars, clear_session_vars
        from tools.registry import registry
        tokens = set_session_vars(platform=args.platform)
        cancelled = threading.Event()
        previous = signal.signal(signal.SIGTERM, lambda *_: cancelled.set())
        try:
            if tool_name not in eligible_tools():
                result = failure('unavailable')
            else:
                if len(args.request.encode()) > 65536:
                    raise ValueError('invalid_request')
                arguments = validate_parameters(registry.get_schema(tool_name)['parameters'], json.loads(args.request))
                max_age = cache_seconds(arguments) if callable(cache_seconds) else cache_seconds
                for override in cache_overrides:
                    if all(arguments.get(key) == value for key, value in override['when'].items()):
                        max_age = override['seconds']
                if type(max_age) is not int or not 0 <= max_age <= 86400: raise ValueError('invalid_cache_age')
                from .selection import native_access_scope, fingerprint
                access = native_access_scope()
                scope = fingerprint({'access': access, 'tool': tool_name, 'arguments': arguments,
                                     'schema': registry.get_schema(tool_name), 'max_age': max_age}) if max_age > 0 and access and access['cacheable'] else None
                if scope and getattr(args, 'reuse_scope', None) == scope:
                    result = {'schema_version': 1, 'reuse': scope}
                else:
                    raw = registry.dispatch(tool_name, arguments, cancelled=cancelled.is_set)
                    if not isinstance(raw, str) or len(raw.encode()) > MAX_JSON_BYTES:
                        raise RuntimeError('invalid_response')
                    result = json.loads(raw)
                    if not isinstance(result, dict) or result.get('schema_version') != 1 or 'error' in result:
                        raise RuntimeError('invalid_response')
                    if (scope and result.get('outcome') in ('ok', 'partial', 'empty')
                            and not item_failures(result.get('data'))
                            and access == native_access_scope()):
                        result['delivery'] = {'reuse_scope': scope, 'max_age_seconds': max_age}
                # Revocation denies publication itself, including uncached and
                # conditional reads. Removing delivery metadata is insufficient.
                if cancelled.is_set():
                    result = failure('cancelled')
                elif access != native_access_scope() or tool_name not in eligible_tools():
                    result = failure('unavailable')
        except ContextUnavailable:
            result = failure('unavailable')
        except (ValueError, WireError, TypeError, RecursionError):
            result = failure('invalid_request')
        except Exception:
            result = failure('source_error')
        finally:
            signal.signal(signal.SIGTERM, previous)
            clear_session_vars(tokens)
        print(json.dumps(result, allow_nan=False))

    ctx.register_cli_command(command_name, description, setup, command)
