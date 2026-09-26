import re

with open('board.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace any backslash-escaped single quotes inside onclick
html = html.replace(r"\'", "'")

with open('board.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Fixed backslashes')
