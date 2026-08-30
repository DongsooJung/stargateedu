from pathlib import Path

SCRIPT = '<script defer src="/assets/analytics-loader.js"></script>'
SKIP_PARTS = {'.git', 'node_modules'}

updated = 0
for path in Path('.').rglob('*.html'):
    if any(part in SKIP_PARTS for part in path.parts):
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        continue
    if 'analytics-loader.js' in text or '</head>' not in text.lower():
        continue
    lower = text.lower()
    pos = lower.rfind('</head>')
    text = text[:pos] + '  ' + SCRIPT + '\n' + text[pos:]
    path.write_text(text, encoding='utf-8')
    updated += 1

print(f'Injected analytics loader into {updated} HTML files')
