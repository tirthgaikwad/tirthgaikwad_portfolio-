import re
import os

# 1. Update saved.html with the correct nav from search.html
with open('search.html', 'r', encoding='utf-8') as f:
    search_content = f.read()
    
nav_match = re.search(r'<nav[^>]*>.*?</nav>', search_content, flags=re.DOTALL)
if nav_match:
    nav_html = nav_match.group(0)
    
    # Remove active classes from all links
    active_class_str = 'text-primary font-semibold border-b-2 border-primary'
    generic_class_str = 'font-label-md text-label-md text-on-surface-variant hover:text-on-surface'
    
    # Simple replace: any link with active_class_str gets generic_class_str instead
    nav_html = re.sub(
        r'class="([^"]*)text-primary font-semibold border-b-2 border-primary([^"]*)"',
        lambda m: f'class="{m.group(1)}{generic_class_str}{m.group(2)}"',
        nav_html
    )
    # Remove aria-current
    nav_html = nav_html.replace('aria-current="page"', '')
    
    # Now find the Saved Profiles link and make it active
    # The Saved Profiles link is: <a class="h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors" data-path="saved" href="saved.html">Saved Profiles</a>
    
    # We will replace its class
    nav_html = re.sub(
        r'<a class="[^"]*" data-path="saved" href="saved\.html">Saved Profiles</a>',
        '<a aria-current="page" class="h-full flex items-center transition-colors text-primary font-semibold border-b-2 border-primary" data-path="saved" href="saved.html">Saved Profiles</a>',
        nav_html
    )

    with open('saved.html', 'r', encoding='utf-8') as f:
        saved_content = f.read()
        
    saved_content = re.sub(r'<nav[^>]*>.*?</nav>', nav_html, saved_content, flags=re.DOTALL)
    
    with open('saved.html', 'w', encoding='utf-8') as f:
        f.write(saved_content)
    print("Fixed saved.html nav block")

# 2. Update index.html, login.html, join.html
for file in ['index.html', 'login.html', 'join.html']:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
        if 'Saved Profiles' not in content:
            # simple append to <nav>
            content = content.replace('</nav>', '    <a href="saved.html">Saved Profiles</a>\n        </nav>')
            with open(file, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Added Saved Profiles to {file}")

# 3. Update ambassador_dashboard.html
if os.path.exists('ambassador_dashboard.html'):
    with open('ambassador_dashboard.html', 'r', encoding='utf-8') as f:
        content = f.read()
    if 'Saved Profiles' not in content:
        # append to header
        content = content.replace('</header>', '    <a href="saved.html" style="margin-left: 20px; font-weight: 600; text-decoration: none; color: #2563eb;">Saved Profiles</a>\n    </header>')
        with open('ambassador_dashboard.html', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Added Saved Profiles to ambassador_dashboard.html")
