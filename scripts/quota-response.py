import datetime, json, re, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(2)
def shape(v, depth=0):
    if depth >= 5:
        return type(v).__name__
    if isinstance(v, dict):
        return {(k if isinstance(k, str) and re.fullmatch(r'[a-zA-Z_][a-zA-Z_0-9-]{0,39}', k) else '<redacted-key>'): shape(x, depth + 1) for k, x in list(v.items())[:30]}
    if isinstance(v, list):
        return [shape(v[0], depth + 1)] if v else []
    return type(v).__name__
def diagnose(v):
    # Schema only: scalar values (including temporary keys and messages) never leave.
    print('quota-read: response shape=' + json.dumps(shape(v)), file=sys.stderr)
    def messages(x, depth=0):
        if depth > 5 or not isinstance(x, dict):
            return []
        out = []
        for k, value in list(x.items())[:30]:
            if k in ['error', 'message', 'detail', 'error_description', 'error_message'] and isinstance(value, str):
                out.append(value.lower())
            elif isinstance(value, dict):
                out.extend(messages(value, depth + 1))
        return out
    text = ' '.join(messages(v))
    patterns = {
        'authentication': r'unauthorized|unauthenticated|not authenticated|invalid.{0,20}token|token.{0,20}expired|expired.{0,20}token|login required',
        'quota': r'quota|rate.limit|usage.limit|exhausted',
    }
    flags = [key for key, pattern in patterns.items() if re.search(pattern, text)]
    print('quota-read: error classifications=' + json.dumps(flags), file=sys.stderr)
if not isinstance(d, dict):
    diagnose(d)
    sys.exit(3)
u = d.get('subs_usage') or {}
if not isinstance(u, dict):
    diagnose(d)
    sys.exit(3)
def pct(w):
    v = (w or {}).get('used_percent')
    return v if isinstance(v, int) and 0 <= v <= 100 else None
def reset(w):
    v = (w or {}).get('resets_at')
    if isinstance(v, int) and v > 0:
        try:
            return datetime.datetime.fromtimestamp(v, datetime.timezone.utc).isoformat()
        except Exception:
            return None
    return None
w = u.get('window')
k = u.get('weekly')
out = {'fivePct': pct(w), 'fiveResetAt': reset(w), 'weeklyPct': pct(k), 'weeklyResetAt': reset(k)}
if '--diagnostics' in sys.argv[1:]:
    fields = ['is_subs_active', 'require_payment', 'has_payment_method', 'can_subscribe', 'show_subs_upsell']
    account = {key: d.get(key) if isinstance(d.get(key), bool) else None for key in fields}
    account['apiKeyPresent'] = isinstance(d.get('api_key'), str) and bool(d['api_key'])
    quota = out if out['fivePct'] is not None or out['weeklyPct'] is not None else None
    print(json.dumps({'account': account, 'quota': quota}))
    sys.exit(0)
if out['fivePct'] is None and out['weeklyPct'] is None:
    diagnose(d)
    # Numeric error codes only: never print messages or tokens.
    e = d.get('error')
    code = e.get('code') if isinstance(e, dict) else None
    code = code if isinstance(code, int) and not isinstance(code, bool) else None
    def kind(v):
        return type(v).__name__
    print('quota-read: missing usage; response=' + kind(d) + '; usage=' + kind(d.get('subs_usage')) + '; window=' + kind(w) + '; weekly=' + kind(k) + '; window_pct=' + kind((w or {}).get('used_percent') if isinstance(w, dict) else None) + '; weekly_pct=' + kind((k or {}).get('used_percent') if isinstance(k, dict) else None) + '; error=' + kind(e) + '; error_code=' + str(code), file=sys.stderr)
    sys.exit(4)
print(json.dumps(out))
