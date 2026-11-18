import sys, time
from playwright.sync_api import sync_playwright
pdf = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1500, 'height': 1000})
    logs = []
    pg.on('console', lambda m: logs.append(m.text[:200]) if m.type in ('error',) else None)
    pg.goto('http://localhost:5173', wait_until='load')
    pg.set_input_files('input[type=file]', pdf)
    pg.wait_for_selector('canvas', timeout=60000)
    pg.get_by_role('button', name='Edit text').click()
    # wait for OCR to finish (auto-runs after block detection)
    t = time.time()
    while time.time() - t < 240:
        txt = pg.inner_text('body')
        if 'Found' in txt and 'blocks' in txt: break
        time.sleep(2)
    print('OCR wait', round(time.time() - t), 's')
    time.sleep(1)
    pg.screenshot(path='e2e_blocks.png')
    btns = pg.locator('button[title]').all()
    titles = [x.get_attribute('title') for x in btns if (x.get_attribute('title') or '').strip()]
    print('blocks:', titles)
    print('errors:', logs[:5])
    b.close()
