from pathlib import Path
import runpy, sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ns = runpy.run_path(str(ROOT / 'tests' / 'production_gate_e2e.py'), run_name='fixture')
html = ns['html']
AUTH_JS = ns['AUTH_JS']
P = F = 0

def ck(cond, name, detail=''):
    global P, F
    if cond:
        P += 1
        print('PASS', name, flush=True)
    else:
        F += 1
        print('FAIL', name, detail, flush=True)

def touch_swipe_menu(page, start_y=360, end_y=150):
    return page.evaluate("""([sy,ey])=>{
      const m=document.getElementById('touchSelectMenuGlobal');
      const x=m.getBoundingClientRect().left+Math.min(80,m.clientWidth/2);
      const target=m.querySelector('.touch-select-option:not([disabled])') || m;
      const mk=(y)=>new Touch({identifier:1,target:target,clientX:x,clientY:y,pageX:x,pageY:y,screenX:x,screenY:y,radiusX:2,radiusY:2,force:.5});
      const s=mk(sy), e=mk(ey);
      target.dispatchEvent(new TouchEvent('touchstart',{touches:[s],targetTouches:[s],changedTouches:[s],bubbles:true,cancelable:true}));
      target.dispatchEvent(new TouchEvent('touchmove',{touches:[e],targetTouches:[e],changedTouches:[e],bubbles:true,cancelable:true}));
      target.dispatchEvent(new TouchEvent('touchend',{touches:[],targetTouches:[],changedTouches:[e],bubbles:true,cancelable:true}));
      return m.scrollTop;
    }""", [start_y, end_y])

def main():
    global P, F
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        c = b.new_context(viewport={'width':800,'height':600}, has_touch=True, is_mobile=False)
        p = c.new_page()
        p.set_default_timeout(10000)
        p.set_content(html, wait_until='domcontentloaded', timeout=120000)
        p.evaluate(AUTH_JS)
        cats = [{'id':f'C{i}','name':f'Category {i:02d}'} for i in range(1,36)]
        pays = [{'id':f'P{i}','name':f'Payee {i:02d}','phone':f'017{i:08d}'} for i in range(1,36)]
        p.evaluate("([cats,pays])=>{window.__mockOverrides.getExpenseBootstrap={categories:cats,payees:pays,bankAccounts:[],currencySymbol:'৳'};goToPage('expense');}", [cats,pays])
        p.wait_for_timeout(500)
        menu = p.locator('#touchSelectMenuGlobal')

        for select_id, target_value in [('expCategory','C30'), ('expPayee','P30')]:
            p.locator(f'#{select_id} + .touch-select-trigger').tap()
            p.wait_for_timeout(80)
            ck(menu.is_visible(), f'{select_id} tablet dropdown opens')
            before = menu.evaluate('e=>e.scrollTop')
            after = touch_swipe_menu(p)
            p.wait_for_timeout(80)
            ck(after > before, f'{select_id} finger swipe scrolls option list', f'before={before} after={after}')
            ck(menu.is_visible(), f'{select_id} remains open while its own list scrolls')
            p.locator('button[data-touch-option-index="30"]').scroll_into_view_if_needed()
            p.locator('button[data-touch-option-index="30"]').tap()
            p.wait_for_timeout(80)
            ck(p.locator(f'#{select_id}').input_value() == target_value, f'{select_id} selects lower scrolled option')

        p.locator('#expCategory + .touch-select-trigger').tap()
        p.wait_for_timeout(80)
        ck(menu.is_visible(), 'Expense Category reopens before page scroll')
        p.evaluate("()=>{const c=document.querySelector('.content'); c.scrollTop=Math.min(c.scrollHeight-c.clientHeight, c.scrollTop+140);}")
        p.wait_for_timeout(120)
        ck(menu.is_hidden(), 'main page scroll closes Expense dropdown')
        b.close()

    print(f'e2e_expense_tablet_touch_select_probe: {P}/{P+F} PASS', flush=True)
    if F:
        sys.exit(1)

if __name__ == '__main__':
    main()
