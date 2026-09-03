document.getElementById('joinForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const statusText = document.getElementById('formStatus');
    statusText.style.display = 'none';

    // Map HTML inputs EXACTLY to the backend ProfileRegister schema
    const userData = {
        name: document.getElementById('regName').value,
        roll_no: document.getElementById('regRoll').value,
        password: document.getElementById('regPass').value, // <-- Added password mapping
        bio: document.getElementById('regBio').value,
        skills: document.getElementById('regSkills').value,
        city: document.getElementById('regCity').value,
        college_name: document.getElementById('regCollege').value,
        department: document.getElementById('regDept').value,
        division: document.getElementById('regDiv').value,
        profile_pic: "",
        banner_pic: ""
    };

    try {
        // Updated to target the correct registration endpoint
        const response = await fetch('http://127.0.0.1:8000/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include', // <-- SECURITY FIX: Accept the cookie upon signup
            body: JSON.stringify(userData)
        });

        if (response.ok) {
            const data = await response.json();
            
            // Backend now automatically logs the user in upon signup by setting the cookie
            localStorage.setItem('currentUserId', data.user_id);

            statusText.style.display = 'block';
            statusText.style.color = 'green';
            statusText.textContent = "Profile created successfully! Initializing secure session...";
            
            setTimeout(() => {
                window.location.href = "search.html"; // Skip login page and go straight to network
            }, 1500);

        } else {
            const errorData = await response.json();
            statusText.style.display = 'block';
            statusText.style.color = 'red';
            statusText.textContent = errorData.detail || "Error creating profile. Please check your inputs.";
            console.error("Backend validation error:", errorData);
        }
    } catch (error) {
        console.error('Error during signup:', error);
        statusText.style.display = 'block';
        statusText.style.color = 'red';
        statusText.textContent = "Server connection error. Is your backend running?";
    }
});