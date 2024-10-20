document.addEventListener("DOMContentLoaded", function () {
    const recruitBotButton = document.getElementById("recruitBotButton");
    const statusStepsButton = document.getElementById("statusStepsButton");
    const chatSidebar = document.getElementById("chatSidebar");
    const conversationDefault = document.querySelector(".conversation-default");
    const conversation1 = document.getElementById("conversation-1");
    const applicationStatusSteps = document.getElementById("application-status-steps");
    const startJobApplication = document.getElementById("startJobApplication");

    // Show RecruitBot conversation
    recruitBotButton.addEventListener("click", (event) => {
        event.preventDefault();
        chatSidebar.style.display = "block";
        conversationDefault.style.display = "block";
        conversation1.style.display = "none";
        applicationStatusSteps.style.display = "none";
    });

    // Show Application Status Steps
    statusStepsButton.addEventListener("click", (event) => {
        event.preventDefault();
        chatSidebar.style.display = "none";
        conversationDefault.style.display = "none";
        conversation1.style.display = "none";
        applicationStatusSteps.style.display = "block";
    });

    // Add event listener for the startJobApplication paragraph
    startJobApplication.addEventListener("click", function() {
        chatSidebar.style.display = "block"; // Show the sidebar
        conversationDefault.style.display = "none"; // Hide default conversation
        conversation1.style.display = "block"; // Show the conversation
        startJobApplicationFunction(); // Call the function to start job application
    });

    // Sidebar functionality
    document.querySelector('.chat-sidebar-profile-toggle').addEventListener('click', function(e) {
        e.preventDefault();
        this.parentElement.classList.toggle('active');
    });

    document.addEventListener('click', function(e) {
        if (!e.target.matches('.chat-sidebar-profile, .chat-sidebar-profile *')) {
            document.querySelector('.chat-sidebar-profile').classList.remove('active');
        }
    });

    // Conversation management
    document.querySelectorAll('.conversation-item-dropdown-toggle').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            if (this.parentElement.classList.contains('active')) {
                this.parentElement.classList.remove('active');
            } else {
                document.querySelectorAll('.conversation-item-dropdown').forEach(function(i) {
                    i.classList.remove('active');
                });
                this.parentElement.classList.add('active');
            }
        });
    });

    document.addEventListener('click', function(e) {
        if (!e.target.matches('.conversation-item-dropdown, .conversation-item-dropdown *')) {
            document.querySelectorAll('.conversation-item-dropdown').forEach(function(i) {
                i.classList.remove('active');
            });
        }
    });

    // Job Application Identification
    function startJobApplicationFunction() {
        fetchJobsFromSupabase().then((jobList) => {
            let jobChoices = jobList.map((job) => {
                return `<button onclick="selectJob(${job.id})">${job.jobTitle}</button>`;
            }).join('');

            document.querySelector('.conversation-main').innerHTML = `
                <p>Hi! Welcome to Prime Infrastructure's recruitment portal. What position are you applying for?</p>
                ${jobChoices}
            `;
        });
    }

    async function fetchJobsFromSupabase() {
        let { data, error } = await supabase.from('jobpositions').select('*').eq('isActiveJob', true);
        if (error) {
            console.error(error);
            return [];
        }
        return data;
    }

    // Existing functions for fetching job positions and details...
    // [Keep the rest of your existing code here, including the other functions]

    // Initialize job positions on page load
    window.onload = fetchJobPositions;
});