import os
import re

tailwind_script = '<script src="https://cdn.tailwindcss.com"></script>'
material_icons = '<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />'
shared_js = '<script src="shared.js"></script>'

count = 0
for filename in os.listdir('.'):
    if filename.endswith('.html'):
        with open(filename, 'r', encoding='utf-8') as f:
            content = f.read()
        
        updated = False
        head_end = content.find('</head>')
        if head_end == -1:
            head_end = content.find('</head >') # edge case
            
        if head_end != -1:
            head_content = content[:head_end]
            additions = ""
            if 'tailwindcss.com' not in head_content:
                additions += f"\n    {tailwind_script}"
            if 'Material+Symbols+Outlined' not in head_content:
                additions += f"\n    {material_icons}"
            if 'shared.js' not in head_content:
                additions += f"\n    {shared_js}"
                
            if additions:
                new_content = content[:head_end] + additions + "\n" + content[head_end:]
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                updated = True
                print(f"Injected dependencies into {filename}")
                count += 1

print(f"Total files updated: {count}")
