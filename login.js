document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const loginId = document.getElementById('loginId').value;
    const loginPass = document.getElementById('loginPass').value;
    const successMsg = document.getElementById('loginSuccess');
    const errorMsg = document.getElementById('loginError');

    successMsg.style.display = 'none';
    errorMsg.style.display = 'none';

    try {
        const response = await fetch('http://127.0.0.1:8000/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include', // <-- SECURITY FIX: Allows the browser to accept the secure cookie
            body: JSON.stringify({
                roll_no: loginId, // Updated to match backend schema exactly
                password: loginPass
            })
        });

        if (response.ok) {
            const data = await response.json();
            
            // THE FIX: We ONLY save the user ID now. 
            // We no longer save the token because it's hidden safely in a cookie!
            localStorage.setItem('currentUserId', data.user_id);

            successMsg.style.display = 'block';
            setTimeout(() => {
                window.location.href = "search.html";
            }, 1000); 

        } else {
            errorMsg.textContent = "Invalid credentials. Please try again.";
            errorMsg.style.display = 'block';
        }
    } catch (error) {
        console.error('Error during login:', error);
        errorMsg.textContent = "Server error. Is your FastAPI backend running?";
        errorMsg.style.display = 'block';
    }
});