import glob
import re

for filepath in glob.glob('*.html'):
    if filepath in ['index.html', 'login.html', 'join.html']:
        continue
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Look for the nav tag opening
    nav_match = re.search(r'<nav[^>]*>', content)
    if not nav_match:
        continue
        
    # Check if "Saved Profiles" is already in the nav
    nav_end = content.find('</nav>', nav_match.end())
    nav_content = content[nav_match.end():nav_end]
    
    if 'Saved Profiles' not in nav_content and 'saved.html' not in nav_content:
        # Find where to insert it. Let's insert it after 'Discover Talent' or at the beginning.
        # Actually, let's just insert it right after <nav ...>
        insert_pos = nav_match.end()
        
        # Check what the first link class is, to copy it (ignoring active classes)
        link_class = 'h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors'
        
        new_link = f'\n        <a class="{link_class}" data-path="saved-profiles" href="saved.html">Saved Profiles</a>'
        
        new_content = content[:insert_pos] + new_link + content[insert_pos:]
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated nav in {filepath}")
    else:
        print(f"Already updated or exists in {filepath}")
