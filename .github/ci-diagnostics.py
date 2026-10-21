"""Bounded local-stack diagnostics; never emit raw reset/start output."""
import json
from pathlib import Path
import re
import sys


def redact(text, values):
    for key, value in values.items():
        if isinstance(value, str) and value and any(word in key.upper() for word in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD')):
            text = text.replace(value, '[REDACTED]')
    text = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text)
    text = re.sub(r'\b[a-z][a-z0-9+.-]*://\S+', '[URL]', text, flags=re.I)
    text = re.sub(r'eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+|gh[pousr]_[\w]+', '[REDACTED]', text)
    text = re.sub(r'(?i)(?:password|secret|token|key)[\w-]*\s*[=:]\s*[^\s,;]+', '[REDACTED]', text)
    return re.sub(r'[A-Za-z0-9_+/=-]{32,}', '[REDACTED]', text)


if sys.argv[1:] == ['--self-test']:
    secret = 'synthetic' + 'Q' * 40
    token = 'eyJ' + 'a' * 20 + '.' + 'b' * 20 + '.' + 'c' * 20
    sample = f'error: secret={secret} https://user:pass@localhost/path {token} short-native-key'
    result = redact(sample, {'SERVICE_ROLE_KEY': 'short-native-key'})
    assert all(value not in result for value in [secret, token, 'user:pass', 'short-native-key'])
    assert redact('error: network not found; SQLSTATE 42P01', {}) == 'error: network not found; SQLSTATE 42P01'
    print('Diagnostic redaction self-check passed')
else:
    values = json.loads(Path('.cache/status.json').read_text()) if Path('.cache/status.json').exists() else {}
    lines = redact(Path(sys.argv[1]).read_text(errors='replace'), values).splitlines()
    errors = [line for line in lines if re.search(r'error|failed|fatal|unhealthy|not found|refused|timed out|SQLSTATE|does not exist', line, re.I)]
    print('Sanitized local-stack failure diagnostics:')
    for line in errors[-12:]:
        print(line[:300])
    if not errors:
        print('No recognized error line; raw output withheld.')
