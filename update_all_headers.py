import os
import re

# Read team.html to extract the inner HTML of the header
with open('team.html', 'r', encoding='utf-8') as f:
    team_content = f.read()

# Find the global header block in team.html
header_match = re.search(r'(<header[^>]*>)([\s\S]*?)(</header>)', team_content)
if not header_match:
    print("Could not find header in team.html")
    exit(1)

inner_html = header_match.group(2).strip()

# Files to skip
skip_files = ['login.html', 'register.html', 'join.html', 'team.html'] # team.html already has it

count = 0
for filename in os.listdir('.'):
    if filename.endswith('.html') and filename not in skip_files:
        with open(filename, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace the contents of the first <header> tag
        def replace_first_header(match):
            return f"{match.group(1)}\n{inner_html}\n{match.group(3)}"
            
        new_content, num_replacements = re.subn(r'(<header[^>]*>)([\s\S]*?)(</header>)', replace_first_header, content, count=1)
        
        if num_replacements > 0:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(new_content)
            count += 1
            print(f"Updated {filename}")

print(f"Total files updated: {count}")
