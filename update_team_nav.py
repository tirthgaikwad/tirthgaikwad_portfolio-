import re

new_nav = """<nav class="flex overflow-x-auto whitespace-nowrap items-center gap-6 h-16 px-4 border-b border-surface-container" style="scrollbar-width: none; -ms-overflow-style: none;" data-active-classes="text-primary font-semibold border-b-2 border-primary">
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="search.html">Discover Talent</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="board.html">Opportunities</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="team.html">My Teams</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="project_management.html">Project Hub</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="college.html">Campus Network</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="department.html">Department</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="global.html">Global</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="research.html">Research Collab</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="network.html">My Network</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="saved.html">Saved Profiles</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="inbox.html">Inbox</a>
    <a class="h-full flex items-center text-sm transition-colors text-on-surface-variant hover:text-on-surface" href="history.html">History</a>
</nav>"""

html = open('team.html', 'r', encoding='utf-8').read()
html = re.sub(r'<nav class="hidden xl:flex items-center gap-6 h-16">.*?</nav>', new_nav, html, flags=re.DOTALL)
with open('team.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Updated team.html')
