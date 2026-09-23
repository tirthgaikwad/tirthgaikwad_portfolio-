import glob
import re

for filepath in glob.glob('*.html'):
    if filepath in ['index.html', 'login.html', 'join.html']:
        continue
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the nav block
    nav_match = re.search(r'<nav[^>]*>.*?</nav>', content, flags=re.DOTALL)
    if not nav_match:
        continue
        
    nav_content = nav_match.group(0)
    
    # 1. Remove the old "Saved Profiles" link wherever it is inside the nav block
    # It might look like: <a class="..." data-path="saved-profiles" href="saved.html">Saved Profiles</a>
    # Or similar. We will just use regex to remove it.
    nav_content_clean = re.sub(r'<a[^>]*href="saved\.html"[^>]*>Saved Profiles</a>', '', nav_content)
    # Also clean up any extra newlines left behind
    nav_content_clean = re.sub(r'\n\s*\n', '\n', nav_content_clean)
    
    # 2. Append the new "Saved Profiles" link right before </nav>
    
    # Check if this is saved.html to apply the active classes
    if filepath == 'saved.html':
        # First, strip active classes from ANY other links in the nav
        # Active classes usually have text-primary, border-primary, font-semibold
        # And non-active have text-on-surface-variant
        
        # Replace the active one with the generic class
        generic_class = 'h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors'
        # The active class used was: class="h-full flex items-center transition-colors text-primary font-semibold border-b-2 border-primary"
        
        # Just safely replace any class that has 'text-primary font-semibold border-b-2 border-primary'
        nav_content_clean = re.sub(
            r'class="[^"]*text-primary font-semibold border-b-2 border-primary[^"]*"',
            f'class="{generic_class}"',
            nav_content_clean
        )
        
        # Also remove aria-current="page" from any old active link
        nav_content_clean = nav_content_clean.replace('aria-current="page"', '')
        
        # Now create the active link for Saved Profiles
        active_class = 'h-full flex items-center transition-colors text-primary font-semibold border-b-2 border-primary'
        new_link = f'        <a aria-current="page" class="{active_class}" data-path="saved" href="saved.html">Saved Profiles</a>\n'
    else:
        generic_class = 'h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors'
        new_link = f'        <a class="{generic_class}" data-path="saved" href="saved.html">Saved Profiles</a>\n'
        
    # Append right before </nav>
    nav_content_final = nav_content_clean.replace('</nav>', new_link + '</nav>')
    
    content = content[:nav_match.start()] + nav_content_final + content[nav_match.end():]
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Fixed nav in {filepath}")
