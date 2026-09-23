import glob, re

nav_links = [
    ('search.html', 'discover-talent', 'Discover Talent'),
    ('board.html', 'opportunities-board', 'Opportunities Board'),
    ('team.html', 'my-teams', 'My Teams'),
    ('project_management.html', 'project-hub', 'Project Hub'),
    ('college.html', 'campus-network', 'Campus Network'),
    ('research.html', 'research-collab', 'Research Collab'),
    ('network.html', 'network', 'My Network'),
    ('saved.html', 'saved', 'Saved Profiles')
]

for filepath in glob.glob('*.html'):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # We find the <nav ...> ... </nav> block
    nav_pattern = re.compile(r'(<nav[^>]*data-active-classes=[^>]*>)(.*?)(</nav>)', re.DOTALL)
    
    if not nav_pattern.search(content):
        continue
    
    new_inner_html = ''
    filename = filepath.lower()
    for link_href, link_data_path, link_text in nav_links:
        if link_href in filename:
            new_inner_html += f'<a aria-current=\"page\" class=\"h-full flex items-center transition-colors text-primary font-semibold border-b-2 border-primary\" data-path=\"{link_data_path}\" href=\"{link_href}\">{link_text}</a>'
        else:
            new_inner_html += f'<a class=\"h-full flex items-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-colors\" data-path=\"{link_data_path}\" href=\"{link_href}\">{link_text}</a>'
    
    def replacer(match):
        return match.group(1) + new_inner_html + match.group(3)
        
    new_content = nav_pattern.sub(replacer, content)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
print('Updated nav in all HTML files.')
