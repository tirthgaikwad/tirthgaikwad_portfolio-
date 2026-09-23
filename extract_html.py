import sys

with open(r'C:\Users\omkar\.gemini\antigravity-ide\brain\c61adce4-66b7-45e0-a642-dcb34c150e96\scratch\user_prompt.txt', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'add a new option or page in the nav bar named "Saved Profiles"' in line:
        # The HTML snippet is likely before this line in the block.
        # Let's search backwards for '<!DOCTYPE html>'
        start_idx = -1
        for j in range(i, -1, -1):
            if '<!DOCTYPE html>' in lines[j]:
                start_idx = j
                break
        
        if start_idx != -1:
            with open(r'C:\Users\omkar\.gemini\antigravity-ide\brain\c61adce4-66b7-45e0-a642-dcb34c150e96\scratch\extracted_saved.html', 'w', encoding='utf-8') as out:
                out.writelines(lines[start_idx:i])
            print(f"Extracted from line {start_idx} to {i}")
