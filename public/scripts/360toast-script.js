document.addEventListener("DOMContentLoaded", async () => {
    try {
        const userId = document.getElementById('userId').value; // Example using a hidden input field
        const response = await fetch(`/employee/api/get360Feedback?userId=${userId}`); // Pass the userId as a query parameter
        const data = await response.json();

        if (data.success && data.feedback) {
            const { startDate, endDate } = data.feedback;

            // Convert the start and end dates to Date objects for comparison
            const today = new Date();
            const feedbackStartDate = new Date(startDate);
            const feedbackEndDate = new Date(endDate);

            // Check if today's date is within the feedback period
            if (today >= feedbackStartDate && today <= feedbackEndDate) {
                // Display the toast notification
                showToast("You have feedback available. Please check your 360 feedback.", "info");

                // Optionally update content dynamically
                document.getElementById("startDate").textContent = feedbackStartDate.toLocaleDateString();
                document.getElementById("endDate").textContent = feedbackEndDate.toLocaleDateString();

                // Button event to redirect to questionnaire page
                document.getElementById("feedback-button").addEventListener("click", () => {
                    window.location.href = "/feedback/questionnaires";
                });
            }
        } else {
            console.error("No feedback available or request failed:", data.message);
        }
    } catch (error) {
        console.error("Error fetching 360 feedback data:", error);
    }
});