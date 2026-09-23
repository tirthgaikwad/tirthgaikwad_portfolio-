with open('college.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if 'id="college-results-grid"' in line:
        start_idx = i
    if '</section>' in line and start_idx != -1 and i > start_idx:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx + 1] + ['</div>\n'] + lines[end_idx:]
    with open('college.html', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print('Replaced successfully')
else:
    print('Could not find indices', start_idx, end_idx)
