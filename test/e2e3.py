import sys, time
from playwright.sync_api import sync_playwright
pdf, mode, out = sys.argv[1], sys.argv[2], sys.argv[3]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1500, 'height': 1000}, accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.goto('http://localhost:5173', wait_until='load')
    pg.set_input_files('input[type=file]', pdf)
    pg.wait_for_selector('canvas', timeout=60000)
    pg.get_by_role('button', name='Edit text').click()
    sel = 'button[title*="dead"]' if mode == 'ocr' else 'button[title*="body"]'
    t = time.time()
    while time.time() - t < 240 and not pg.locator(sel).count(): time.sleep(1)
    print('block found:', pg.locator(sel).count(), 'after', round(time.time()-t), 's')
    pg.locator(sel).first.click()
    t = time.time()
    while time.time() - t < 60 and 'Rebuilding' in pg.inner_text('body'): time.sleep(0.5)
    time.sleep(1)
    ed = pg.locator('[contenteditable]').first
    ed.click(); pg.keyboard.press('Control+A')
    pg.keyboard.type('Cuando estaba en un callejón sin salida, un encuentro milagroso lo cambió todo.' if mode == 'ocr'
                     else 'Mi cuerpo por fin se rebeló contra el trabajo… ¿Qué más?')
    pg.locator('body').click(position={'x': 5, 'y': 500})
    time.sleep(1)
    pg.screenshot(path=out + '_editor.png')
    print('panel font/outline:', pg.locator('select').first.input_value(), '| outline checked:', pg.get_by_label('Outline').is_checked() if pg.get_by_label('Outline').count() else 'n/a')
    with pg.expect_download(timeout=120000) as dl:
        pg.get_by_role('button', name='Export PDF').click()
    dl.value.save_as(out + '.pdf')
    print('saved', out + '.pdf', 'errors:', errs[:3])
    b.close()
