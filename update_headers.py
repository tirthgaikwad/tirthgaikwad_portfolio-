import glob, os, re

for f in glob.glob('*.html'):
    if f in ['index.html', 'login.html', 'join.html']: 
        continue
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Inject shared.js
    if 'shared.js' not in content:
        content = content.replace('</body>', '<script src="shared.js"></script>\n</body>')
    
    # Add data-header-avatar
    content = re.sub(
        r'(<div[^>]*class="[^"]*w-8 h-8 rounded-full bg-primary flex items-center justify-center[^"]*")>', 
        r'\1 data-header-avatar>', 
        content
    )
    
    # Add data-notif-btn and remove onclick
    content = re.sub(
        r'(<button[^>]*aria-label="Notifications"[^>]*)>', 
        r'\1 data-notif-btn>', 
        content
    )
    content = re.sub(
        r'(data-notif-btn[^>]*)onclick="[^"]*"', 
        r'\1', 
        content
    )
    
    # Add data-notif-badge
    content = re.sub(
        r'(<span[^>]*class="[^"]*absolute top-1.5 right-1.5 w-4 h-4 bg-error text-on-error[^"]*")[^>]*>[^<]*</span>', 
        r'\1 data-notif-badge style="display:none;"></span>', 
        content
    )
    
    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)

print("Updated HTML files.")
