import glob

for filepath in glob.glob('*.html'):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    history_btn_html = '''<button aria-label="Direct Messages" class="relative p-space-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg transition-colors" type="button"><span class="material-symbols-outlined text-[20px]">chat_bubble</span></button>
<div class="relative group inline-block">
    <button aria-label="Settings" class="relative p-space-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg transition-colors" type="button">
        <span class="material-symbols-outlined text-[20px]">menu</span>
    </button>
    <div class="absolute right-0 top-full mt-2 w-48 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/40 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
        <a href="history.html" class="flex items-center gap-2 px-4 py-3 text-on-surface hover:bg-surface-container-low transition-colors font-label-md">
            <span class="material-symbols-outlined text-[20px]">history</span>
            Activity History
        </a>
    </div>
</div>'''
    
    if 'Activity History' in content:
        continue
        
    # Standard string replace on the exact button tag.
    old_btn = '<button aria-label="Direct Messages" class="relative p-space-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low rounded-lg transition-colors" type="button"><span class="material-symbols-outlined text-[20px]">chat_bubble</span></button>'
    
    if old_btn in content:
        new_content = content.replace(old_btn, history_btn_html)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

print("Replaced via direct string replacement")
