import glob
import re

def fix_nav():
    for f in glob.glob('*.html'):
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # Check if it already has 'network.html'
        if 'href="network.html"' not in content:
            target = '<a class="h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors" data-path="saved" href="saved.html">Saved Profiles</a>'
            
            # The exact match might differ slightly (like data-path="saved" vs active class)
            target_regex = re.compile(r'(<a[^>]*href="saved\.html"[^>]*>.*?</a>)')
            
            replacement = r'<a class="h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors" data-path="network" href="network.html">My Network</a>\1'
            
            if re.search(target_regex, content):
                content = re.sub(target_regex, replacement, content, count=1)
                with open(f, 'w', encoding='utf-8') as file:
                    file.write(content)
                print('Fixed ' + f)
            else:
                print('Could not find target in ' + f)

fix_nav()
