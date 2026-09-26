import re

# Read HTML
with open('board.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Update the button onclick
html = re.sub(
    r'onclick="window\.showSystemModal\(\'Post Opportunity\'[^"]+"\)',
    r'onclick="window.openPostOpportunityModal()"',
    html
)

# 2. Prepare the modal HTML and JS
modal_code = """
<!-- Post Opportunity Modal -->
<div id="postOppModal" class="fixed inset-0 z-[100] hidden items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity">
    <div class="bg-surface-container-lowest w-[90%] max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col transform scale-95 transition-transform duration-200" id="postOppModalContent">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-surface-container flex items-center justify-between bg-surface-container-low">
            <h3 class="font-headline-sm text-on-surface">Post a New Opportunity</h3>
            <button onclick="window.closePostOpportunityModal()" class="text-on-surface-variant hover:text-error transition-colors p-1 rounded-lg hover:bg-surface-container">
                <span class="material-symbols-outlined">close</span>
            </button>
        </div>
        <!-- Body -->
        <div class="p-6 overflow-y-auto max-h-[70vh]">
            <form id="postOppForm" class="flex flex-col gap-4">
                <div>
                    <label class="block font-label-md text-on-surface-variant mb-1">Category</label>
                    <select id="po-category" class="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                        <option value="Hackathon">Hackathon</option>
                        <option value="Side Project">Side Project</option>
                        <option value="Research / AI">Research / AI</option>
                        <option value="Open Source">Open Source</option>
                    </select>
                </div>
                <div>
                    <label class="block font-label-md text-on-surface-variant mb-1">Title</label>
                    <input type="text" id="po-title" required placeholder="e.g. Need a frontend dev for my AI project" class="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                </div>
                <div>
                    <label class="block font-label-md text-on-surface-variant mb-1">Skills Required (comma separated)</label>
                    <input type="text" id="po-skills" required placeholder="e.g. React, Tailwind, Python" class="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                </div>
                <div>
                    <label class="block font-label-md text-on-surface-variant mb-1">Description</label>
                    <textarea id="po-description" required rows="4" placeholder="Describe the opportunity in detail..." class="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all resize-none"></textarea>
                </div>
            </form>
        </div>
        <!-- Footer -->
        <div class="px-6 py-4 border-t border-surface-container bg-surface-container-lowest flex items-center justify-end gap-3">
            <button onclick="window.closePostOpportunityModal()" class="px-5 py-2 rounded-xl font-label-md text-on-surface-variant hover:bg-surface-container transition-colors">Cancel</button>
            <button onclick="window.submitPostOpportunity()" class="px-5 py-2 rounded-xl bg-primary text-on-primary font-label-md shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-2">
                <span id="po-btn-text">Post Now</span>
                <span class="material-symbols-outlined text-[18px]">send</span>
            </button>
        </div>
    </div>
</div>
"""

js_code = """
<script>
window.openPostOpportunityModal = function() {
    const m = document.getElementById('postOppModal');
    const c = document.getElementById('postOppModalContent');
    m.classList.remove('hidden');
    m.classList.add('flex');
    setTimeout(() => {
        c.classList.remove('scale-95');
        c.classList.add('scale-100');
    }, 10);
};
window.closePostOpportunityModal = function() {
    const m = document.getElementById('postOppModal');
    const c = document.getElementById('postOppModalContent');
    c.classList.remove('scale-100');
    c.classList.add('scale-95');
    setTimeout(() => {
        m.classList.add('hidden');
        m.classList.remove('flex');
        document.getElementById('postOppForm').reset();
    }, 200);
};
window.submitPostOpportunity = function() {
    const category = document.getElementById('po-category').value;
    const title = document.getElementById('po-title').value.trim();
    const skills = document.getElementById('po-skills').value.trim();
    const description = document.getElementById('po-description').value.trim();

    if (!title || !skills || !description) {
        window.showSystemModal('Error', 'Please fill in all fields.', 'alert');
        return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
        window.showSystemModal('Error', 'You must be logged in to post an opportunity.', 'alert');
        return;
    }

    const payload = {
        category: category,
        title: title,
        description: description,
        skills_required: skills
    };

    const btnText = document.getElementById('po-btn-text');
    btnText.textContent = 'Posting...';

    fetch('http://127.0.0.1:8000/api/board/posts', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error('Failed to post opportunity.');
        return res.json();
    })
    .then(data => {
        btnText.textContent = 'Post Now';
        window.closePostOpportunityModal();
        window.showSystemModal('Success', 'Opportunity posted successfully!', 'alert');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    })
    .catch(err => {
        console.error(err);
        btnText.textContent = 'Post Now';
        window.showSystemModal('Error', 'An error occurred while posting.', 'alert');
    });
};
</script>
"""

# Inject right before </body>
if '</body>' in html:
    html = html.replace('</body>', f'{modal_code}\n{js_code}\n</body>')

with open('board.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("Added Post Opportunity logic.")
