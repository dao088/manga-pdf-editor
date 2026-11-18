import sys, time
from playwright.sync_api import sync_playwright
pdf = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1500, 'height': 1000})
    pg.goto('http://localhost:5173', wait_until='load')
    pg.set_input_files('input[type=file]', pdf)
    pg.wait_for_selector('canvas', timeout=60000)
    pg.get_by_role('button', name='Edit text').click()
    t = time.time()
    while time.time() - t < 240:
        if pg.locator('button[title*="dead"]').count(): break
        time.sleep(1)
    time.sleep(1)
    pg.locator('button[title*="dead"]').first.click()
    t = time.time()
    while time.time() - t < 60 and 'Rebuilding' in pg.inner_text('body'): time.sleep(0.5)
    print('cover ready after', round(time.time()-t,1), 's')
    time.sleep(1)
    pg.screenshot(path='e2e_edit1.png')
    ed = pg.locator('[contenteditable]').first
    ed.click()
    pg.keyboard.press('Control+A')
    pg.keyboard.type('Cuando estaba en un callejón sin salida, un encuentro milagroso lo cambió todo.')
    pg.locator('body').click(position={'x': 5, 'y': 500})
    time.sleep(1)
    pg.screenshot(path='e2e_edit2.png')
    print('font panel:', pg.inner_text('body')[:600].replace('\n',' | '))
    b.close()
