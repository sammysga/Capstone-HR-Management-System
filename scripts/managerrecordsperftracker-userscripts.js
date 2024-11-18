
// let currentStep = 0; // Track the current step

// // Parse viewState back into an object
// const viewStateElement = document.getElementById('viewState');
// const viewState = JSON.parse(viewStateElement.getAttribute('data-viewstate'));
// let userId = '<%= user.userId %>'; // Pass userId from server-side
// let jobId = viewState.jobId; // Use jobId from viewState
// let submittedObjectives = viewState.submittedObjectives || []; // Initialize with submitted objectives
// const hardSkills = viewState.hardSkills || []; // Default to empty array if not defined
// const softSkills = viewState.softSkills || []; // Default to empty array if not defined

// // Document ready event listener
// document.addEventListener("DOMContentLoaded", function () {
//     // Add event listeners to each step
//     document.querySelectorAll('.step').forEach(step => {
//         step.addEventListener('click', function(event) {
//             const stepId = this.getAttribute('id');
//             if (!this.classList.contains('disabled')) {
//                 handleStepClick(stepId, event);
//             }
//         });
//     });

//     // Set up the objectives button click event
//     const objectivesButton = document.getElementById("objectivesButton");
//     if (objectivesButton) {
//         objectivesButton.addEventListener("click", handleObjectiveClick);
//     } else {
//         console.error('Objectives Button not found in the DOM.');
//     }

//     // Initial display update when the document is loaded
//     console.log('Document loaded. Updating display...');
// });

// // Step click handler
// function handleStepClick(stepId, event) {
//     switch (stepId) {
//         case 'objectivesButton':
//             handleObjectiveClick();
//             break;
//         case 'feedbackButtonQ1':
//         case 'feedbackButtonQ2':
//         case 'feedbackButtonQ3':
//         case 'feedbackButtonQ4':
//             showFeedbackForm(event);
//             break;
//         default:
//             console.warn('Unknown step clicked:', stepId);
//     }
// }

// // Function to handle objective clicks
// function handleObjectiveClick() {
//     console.log("Objective clicked. View only status:", viewState.viewOnlyStatus.objectivesettings);

//     // Hide the feedback form when switching to objectives
//     const feedbackSection = document.getElementById("feedback-section");
//     feedbackSection.style.display = "none"; // Hide feedback section

//     // Get the form and view-only sections
//     const formSection = document.getElementById("objective-skill-progress-form");
//     const viewOnlySection = document.getElementById("view-only-page");

//     // Check if the view-only status is true
//     if (viewState.viewOnlyStatus.objectivesettings) {
//         // Show the view-only section
//         displaySubmittedObjectives(submittedObjectives); // Populate the view-only section with existing data
//         viewOnlySection.style.display = "block"; // Show view-only page
//         formSection.style.display = "none"; // Ensure the form is hidden
//         console.log("Showing view-only page with submitted objectives.");
//     } else {
//         // Show the editable form
//         formSection.style.display = "block"; // Show the form
//         viewOnlySection.style.display = "none"; // Ensure the view-only section is hidden
//         console.log("Showing editable objective form.");
//     }
// }

// // Function to update display based on view state
// function updateDisplay() {
//     console.log('Updating display...');

//     // Hide all sections initially
//     const formSection = document.getElementById("objective-skill-progress-form");
//     const viewOnlySection = document.getElementById("view-only-page");

//     // Ensure elements exist before accessing their styles
//     if (formSection) {
//         formSection.style.display = "none"; 
//     } else {
//         console.error("Objective Skill Progress Form section not found.");
//     }

//     if (viewOnlySection) {
//         viewOnlySection.style.display = "none"; 
//     } else {
//         console.error("View Only Page section not found.");
//     }

//     // Check the view state and submitted objectives
//     if (viewState.viewOnlyStatus.objectivesettings) {
//         // Show view-only page only if there are submitted objectives
//         if (submittedObjectives.length > 0) {
//             displaySubmittedObjectives(submittedObjectives);
//             viewOnlySection.style.display = "block"; // Show view-only page
//             console.log("Showing view-only page with submitted objectives.");
//         } else {
//             console.log("No objectives submitted yet for view-only mode.");
//         }
//     } else {
//         showObjectiveForm(); // Show form if in edit mode
//         formSection.style.display = "block"; // Show the form
//         console.log("Showing editable objective form.");
//     }
// }

// // Function to show the objective form
// function showObjectiveForm() {
//     console.log("Showing objective form.");
//     document.getElementById("objective-skill-progress-form").style.display = "block"; // Ensure form is visible
// }
// function showFeedbackForm(event) {
//     const quarter = event.currentTarget.getAttribute('data-quarter');
//     console.log("Show Feedback Form called for quarter:", quarter);
//     console.log("User ID:", userId);

//     // Fetch feedback data for the selected quarter via an API call
//     fetch(`/linemanager/records-performance-tracker/${userId}?quarter=${quarter}`)

//         .then(response => response.json())
//         .then(feedbackData => {
//             console.log("Feedback data fetched:", feedbackData);

//             // Check if feedbackData is valid and has the expected structure
//             if (feedbackData.success && feedbackData.feedbacksByQuarter) {
//                 const feedbackQuarterData = feedbackData.feedbacksByQuarter[quarter]; // Access feedbacks for the specific quarter
//                 console.log("Feedback for quarter:", feedbackQuarterData);

//                 // Display feedback data
//                 displayFeedbackData(feedbackQuarterData); // Call the function to display feedback data
//                 console.log("Feedback data displayed successfully.");

//                 // Check if questionnaire data is available
//                 const questionnaire = feedbackData.questionnaire; // Access the questionnaire data
//                 if (questionnaire) {
//                     // Determine if the user is in view-only mode based on the startDate
//                     const currentDate = new Date();
//                     const startDate = new Date(questionnaire.startDate); // Assuming startDate is part of the questionnaire data
//                     const isViewOnlyMode = currentDate >= startDate; // Set to true if current date is past or equal to startDate

//                     // Display the questionnaire in view-only or editable mode
//                     if (isViewOnlyMode) {
//                         console.log("Displaying questionnaire in view-only mode.");
//                         displayQuestionnaireViewOnly(questionnaire);
//                     } else {
//                         console.log("Displaying questionnaire in editable mode.");
//                         displayQuestionnaireEditable(feedbackQuarterData); // Pass the feedbackQuarterData to displayQuestionnaireEditable
//                     }
//                 } else {
//                     console.error("No questionnaire data available.");
//                     alert("Failed to fetch valid questionnaire data.");
//                 }
//             } else {
//                 console.error("Invalid feedback data structure:", feedbackData);
//                 alert("Failed to fetch valid feedback data.");
//             }
//         })
//         .catch(error => {
//             console.error("Error fetching feedback data:", error);
//             alert("An error occurred while fetching feedback data.");
//         });
// }



// // Function to display submitted objectives
// function displaySubmittedObjectives(objectives) {
//     const tableBody = document.getElementById("view-only-table-body");
//     tableBody.innerHTML = ""; // Clear previous content

//     objectives.forEach(obj => {
//         const row = document.createElement("tr");
//         row.innerHTML = `
//             <td>${obj.objectiveDescrpt || 'N/A'}</td>
//             <td>${obj.objectiveKPI || 'N/A'}</td>
//             <td>${obj.objectiveTarget || 'N/A'}</td>
//             <td>${obj.objectiveUOM || 'N/A'}</td>
//             <td>${(obj.objectiveAssignedWeight * 100) || 'N/A'} %</td>
//         `;
//         tableBody.appendChild(row);
//     });
// }
//                 // Function to remove a row from the objective form
//                 function removeRow(button) {
//                     const row = button.parentNode.parentNode;
//                     row.parentNode.removeChild(row);
//                     updateTotalWeight(); // Update total weight after removal
//                 }
            
//                 // Function to add a new row to the objective form
//                 function addRow() {
//         const tableBody = document.getElementById("progress-table-body");
//         const newRow = document.createElement("tr");
//         newRow.innerHTML = `
//             <td><input type="text" placeholder="Enter Objective" name="objectiveDescrpt" required></td>
//             <td><input type="text" placeholder="Enter KPI" name="objectiveKPI" required></td>
//             <td><input type="text" placeholder="Enter Target" name="objectiveTarget" required></td>
//             <td><input type="text" placeholder="Enter UOM" name="objectiveUOM" required></td>
//             <td><input type="number" class="weight-input" oninput="updateTotalWeight()" placeholder="Enter Weight (%)" name="objectiveAssignedWeight" min="0" max="100" required></td>
//             <td><button type="button" onclick="removeRow(this)">Remove</button></td>
//         `;
//         tableBody.appendChild(newRow);
//     }
            



//                 // Function to update total weight in the form
//                 function updateTotalWeight() {
//                     const weightInputs = document.querySelectorAll(".weight-input");
//                     let totalWeight = 0;
            
//                     weightInputs.forEach(input => {
//                         totalWeight += parseFloat(input.value) || 0;
//                     });
            
//                     document.getElementById("totalWeight").value = totalWeight;
//                 }
            
//                 // Function to save objectives
//                 async function saveObjectives() {
//                     const departmentId = '<%= user.departmentId %>'; // Pass departmentId from server-side
//                     const performancePeriodYear = document.getElementById("performanceDate").textContent;
            
//                     console.log("User  ID:", userId);
//                     console.log("Job ID:", jobId);
//                     console.log("Performance Period Year:", performancePeriodYear);
            
//                     // Validate required IDs
//                     if (!userId || !jobId ) {
//                         console.error("One or more required IDs are missing.");
//                         alert("Please ensure all fields are filled out correctly before saving.");
//                         return;
//                     }
            
//                     const objectives = [];
//                     const rows = document.querySelectorAll("#progress-table-body tr");
            
//                     // Ensure confirmation checkbox is checked
//                     const confirmationChecked = document.getElementById("confirmationCheckbox").checked;
//                     if (!confirmationChecked) {
//                         alert("Please confirm that you have reviewed the objectives before saving.");
//                         return;
//                     }
            
//                     let totalWeight = 0;
            
//                     rows.forEach(row => {
//                         const descriptionInput = row.querySelector('input[name="objectiveDescrpt"]');
//                         const kpiInput = row.querySelector('input[name="objectiveKPI"]');
//                         const targetInput = row.querySelector('input[name="objectiveTarget"]');
//                         const uomInput = row.querySelector('input[name="objectiveUOM"]');
//                         const weightInput = row.querySelector('input[name="objectiveAssignedWeight"]');
            
//                         if (descriptionInput && kpiInput && targetInput && uomInput && weightInput) {
//                             const weight = parseFloat(weightInput.value);
//                             totalWeight += weight;
            
//                             const objective = {
//                                 objectiveDescrpt: descriptionInput.value,
//                                 objectiveKPI: kpiInput.value,
//                                 objectiveTarget: targetInput.value,
//                                 objectiveUOM: uomInput.value,
//                                 objectiveAssignedWeight: weight,
//                             };
//                             objectives.push(objective);
//                         }
//                     });
            
//                     console.log("Objectives to save:", objectives);
            
//                     // Validate total weight
//                     if (totalWeight !== 100) {
//                         alert("Total assigned weight must be 100% to save.");
//                         return;
//                     }
            
//                     // Proceed if objectives are present
//                     if (objectives.length > 0) {
//                         try {
//                             const response = await fetch(`/linemanager/records-performance-tracker/${userId}`, {
//                                 method: 'POST',
//                                 headers: { 'Content-Type': 'application/json' },
//                                 body: JSON.stringify({
//                                     jobId,
//                                     departmentId,
//                                     performancePeriodYear,
//                                     objectives,
//                                     totalWeight
//                                 })
//                             });
            
//                             console.log("Response from server:", response);
            
//                             // Check if the response was successful
//                             if (!response.ok) {
//                                 throw new Error(`Server responded with status ${response.status}`);
//                             }
            
//                             const result = await response.json();
//                             console.log("Result from server:", result);
            
//                             if (result.success) {
//                                 alert(result.message); // Handle success
//                                 displaySubmittedObjectives(objectives); // Display the submitted objectives
            
//                                 // Redirect to the view-only page after successful save
//                                 const viewUrl = `/linemanager/records-performance-tracker/${userId}`;
//                                 window.location.href = viewUrl;
//                             } else {
//                                 alert("Failed to save objectives: " + result.message);
//                             }
//                         } catch (error) {
//                             console.error("Error saving objectives:", error);
//                             alert("An error occurred while saving objectives.");
//                         }
//                     } else {
//                         alert("No objectives to save.");
//                     }
//                 }
                

//                 function toggleEditMode(isEditMode) {
//     const feedbackRows = document.querySelectorAll('#feedback-table-body tr');
//     feedbackRows.forEach(row => {
//         const inputRow = row.nextElementSibling; // Assuming inputRow follows the main row
//         if (inputRow) {
//             inputRow.style.display = isEditMode ? 'table-row' : 'none'; // Show input row in edit mode
//             row.style.fontWeight = isEditMode ? 'normal' : 'bold'; // Change font weight for view mode
//             row.querySelectorAll('input').forEach(input => {
//                 input.disabled = !isEditMode; // Enable or disable inputs based on edit mode
//             });
//         }
//     });

//     // Toggle button text
//     document.getElementById('toggleEditButton').innerText = isEditMode ? 'View Feedback' : 'Edit Feedback';
// }
// async function fetchFeedbackData(userId, quarter) {
//     try {
//         const response = await fetch(`/linemanager/records-performance-tracker/${userId}?quarter=${quarter}`);
        
//         // Check if the response is OK (status in the range 200-299)
//         if (!response.ok) {
//             const errorText = await response.text(); // Get the response text for debugging
//             console.error(`Error: ${response.status} ${response.statusText}`, errorText);
//             alert('Failed to fetch feedback data. Please check the server.');
//             return { success: false }; // Indicate failure
//         }

//         // Try to parse the response as JSON
//         const data = await response.json();

//         // Check if the data structure is valid
//         if (!data.success) {
//             console.error('Invalid data structure received:', data);
//             alert('Failed to fetch valid feedback data.');
//             return { success: false }; // Indicate failure
//         }

//         console.log('Feedback data fetched successfully:', data);
//         return data; // Return the fetched data
//     } catch (error) {
//         console.error('Error fetching feedback data:', error);
//         alert('An unexpected error occurred while fetching feedback data.');
//         return { success: false }; // Indicate failure
//     }
// }

// // Render feedback data for the specified quarter
// async function renderFeedback(userId, quarter) {
//     const feedbackData = await fetchFeedbackData(userId, quarter); // Fetch data for the specific quarter

//     // Check if feedbackData is valid and has the expected structure
//     if (feedbackData.success && feedbackData.feedbacksByQuarter) {
//         const feedbackQuarterData = feedbackData.feedbacksByQuarter[quarter]; // Access feedbacks for the specific quarter
//         console.log("Feedback for quarter:", feedbackQuarterData);

//         if (feedbackQuarterData && feedbackQuarterData.length > 0) {
//             displayFeedbackData(feedbackQuarterData); // Call the function to display feedback data
//         } else {
//             console.log("No feedback data available for this quarter.");
//         }
//     } else {
//         console.error("Invalid feedback data structure:", feedbackData);
//         alert("Failed to fetch valid feedback data.");
//     }
// }


// // Function to toggle the visibility of the rating section
//                 function addFormFeedbackRow(objective) {
//     const tbody = document.getElementById('feedback-table-body');
//     const row = document.createElement('tr');

//     // Populate the main row with text display only
//     row.innerHTML = `
//     <td><strong>${objective.objectiveDescrpt || 'N/A'}</strong></td>
//     <td><strong>${objective.objectiveKPI || 'N/A'}</strong></td>
//     <td><strong>${objective.objectiveTarget || 'N/A'}</strong></td>
//     <td><strong>${objective.objectiveUOM || '%'}</strong></td>
//     <td><strong>${(objective.objectiveAssignedWeight * 100) || 'N/A'} %</strong></td>
// `;

//     tbody.appendChild(row);

//     // Create a new row for the input fields
//     const inputRow = document.createElement('tr');

//     inputRow.innerHTML = `
//     <td colspan="5">
//         <div style="margin-bottom: 10px;">
//             <label for="qualitativeInput"> ▶ Guide Question here for qualitative and quantitative feedback:</label>
//             <input id="qualitativeInput" type="text" placeholder="Input your guide question here." name="kraObjectivesInput" required style="width: 100%; box-sizing: border-box;">
//         </div>
//         <div style="margin-bottom: 10px;">
//             <button type="button" onclick="toggleRatingSection('ratingSection${tbody.children.length}')" style="background-color: gray; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px;">
//                 View Rater's View
//             </button>
//             <div id="ratingSection${tbody.children.length}" style="display: none; margin-top: 10px;">
//                 <div style="margin-bottom: 10px;">
//                     <label>Quantitative (Rating Scale):</label>
//                     <div style="font-size: 14px; margin-top: 5px;">
//                         Rate from 1-5 based on how well the individual achieved the target or goal related to the guide question.
//                     </div>
//                     <span style="font-size: 24px; cursor: pointer;" id="starRating${tbody.children.length}" data-rating="0">
//                         <i class="fa-solid fa-star" data-value="1"></i>
//                         <i class="fa-solid fa-star" data-value="2"></i>
//                         <i class="fa-solid fa-star" data-value="3"></i>
//                         <i class="fa-solid fa-star" data-value="4"></i>
//                         <i class="fa-solid fa-star" data-value="5"></i>
//                     </span>
//                 </div>
//                 <div style="margin-bottom: 10px;">
//                     <label>Qualitative (Open-ended):</label>
//                     <div style="font-size: 14px; margin-top: 5px;">
//                        Provide qualitative feedback on the guide question to assess if the target was achieved.
//                     </div>
//                     <input type="text" placeholder="Place your Qualitative feedback here." style="width: 100%; box-sizing: border-box;" readonly>
//                 </div>
//             </div>
//         </div>
//     </td>
//     `;

//     tbody.appendChild(inputRow);

//     // Add click event listeners to the stars
//     const stars = document.querySelectorAll(`#starRating${tbody.children.length} .fa-star`);
//     stars.forEach(star => {
//         star.addEventListener('click', function() {
//             const rating = this.getAttribute('data-value');
//             const starContainer = document.getElementById(`starRating${tbody.children.length}`);
//             starContainer.setAttribute('data-rating', rating);
//             updateStarDisplay(stars, rating);
//         });
//     });
// }

//  // Function to update 360 degree feedback hard and soft skill rows
//  function addFormFeedbackSkillsRows(skills, skillType) {
//     const skillTableBody = document.querySelector(`#${skillType}-skills-table-body`);

//     // Check if the table body exists
//     if (!skillTableBody) {
//         console.log("Skill table body not found for:", skillType);
//         return;
//     }

//     // Iterate over the array of skills and add each one
//     skills.forEach(skill => {
//         // Create the skill row
//         const row = document.createElement('tr');
//         row.innerHTML = `
//             <td>
//                 <span><strong>${skill.jobReqSkillName}</strong></span>
//             </td>
//         `;
//         skillTableBody.appendChild(row);

//         // Create a new row for input fields
//         const inputRow = document.createElement('tr');
//         const starRatingId = `${skillType}SkillRow${skill.jobReqSkillName}Rating`;

//         // Create a unique ID for the collapsible section
//         const ratingSectionId = `ratingSection${skill.jobReqSkillName.replace(/\s+/g, '_')}`; // Replace spaces for valid ID

//         inputRow.innerHTML = `
//         <td colspan="1">
//             <button type="button" onclick="toggleRatingSection('${ratingSectionId}')" style="background-color: gray; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px;">
//                 View Rater's View
//             </button>
//             <div id="${ratingSectionId}" style="display: none; margin-top: 10px;">
//                 <div style="margin-bottom: 10px;">
//                     <label><strong>Quantitative (Rating Scale):</strong></label>
//                     <div style="font-size: 14px; margin-top: 5px;">
//                         Rate from 1 to 5 based on the corresponding skill performed during the quarter.
//                     </div>
//                     <span style="font-size: 24px; cursor: pointer;" id="${starRatingId}" data-rating="0">
//                         <i class="fa-solid fa-star" data-value="1" onclick="setRating('${starRatingId}', 1)"></i>
//                         <i class="fa-solid fa-star" data-value="2" onclick="setRating('${starRatingId}', 2)"></i>
//                         <i class="fa-solid fa-star" data-value="3" onclick="setRating('${starRatingId}', 3)"></i>
//                         <i class="fa-solid fa-star" data-value="4" onclick="setRating('${starRatingId}', 4)"></i>
//                         <i class="fa-solid fa-star" data-value="5" onclick="setRating('${starRatingId}', 5)"></i>
//                     </span>
//                 </div>
//                 <div style="margin-bottom: 10px;">
//                     <label><strong>Qualitative (Open-ended):</strong></label>
//                     <div style="font-size: 14px; margin-top: 5px;">
//                         Provide qualitative feedback based on the corresponding skill performed during the quarter.
//                     </div>
//                     <input type="text" placeholder="Place your qualitative feedback here." style="width: 100%; box-sizing: border-box;">
//                 </div>
//             </div>
//         </td>
//         `;

//         skillTableBody.appendChild(inputRow);
//     });
// }


// function updateStarDisplay(stars, rating) {
//     stars.forEach(star => {
//         const starValue = star.getAttribute('data-value');
//         star.style.color = starValue <= rating ? 'gold' : 'gray';
//     });
// }

// function toggleRatingSection(sectionId) {
//     const section = document.getElementById(sectionId);
//     section.style.display = section.style.display === 'none' ? 'block' : 'none';
// }


// function setRating(rowId, rating) {
//     const starRating = document.getElementById(`${rowId}Rating`);
    
//     // Get all star icons (they are <i> elements)
//     const stars = starRating.getElementsByTagName('i');
    
//     // Loop through the stars and apply the "checked" class based on the rating
//     for (let i = 0; i < stars.length; i++) {
//         if (i < rating) {
//             stars[i].classList.add('checked');  // Add "checked" class for selected stars
//         } else {
//             stars[i].classList.remove('checked');  // Remove "checked" class for unselected stars
//         }
//     }
    
//     // Update the data-rating attribute to reflect the selected rating
//     starRating.setAttribute('data-rating', rating);
// }

// // Show Feedback Form
// // Assuming this is in your client-side JavaScript file (e.g., feedback.js)
// function displayFeedbackData(feedbackQuarterData) {
//     const feedbackTableBody = document.getElementById('feedback-table-body');
//     feedbackTableBody.innerHTML = ''; // Clear previous content

//     // Loop through each feedback entry for the quarter
//     feedbackQuarterData.forEach(feedback => {
//         // Display objectives
//         feedback.objectives.forEach(objective => {
//             const row = document.createElement('tr');
//             row.innerHTML = `
//                 <td><strong>${objective.objectiveQualiQuestion}</strong></td>
//                 <td><input type="text" placeholder="Your response here" name="response_${objective.feedback_qObjectivesId}" required></td>
//             `;
//             feedbackTableBody.appendChild(row);
//         });

//         // Display skills (if needed)
//         feedback.skills.forEach(skill => {
//             const skillRow = document.createElement('tr');
//             skillRow.innerHTML = `
//                 <td><strong>Skill ID: ${skill.jobReqSkillId}</strong></td>
//                 <td><input type="text" placeholder="Your feedback on this skill" name="skill_response_${skill.feedback_qSkillsId}" required></td>
//             `;
//             feedbackTableBody.appendChild(skillRow);
//         });
//     });
// }


//     async function saveQ1_360Feedback() {
//     const startDate = document.getElementById('startDate').value; // Capture start date from input
//     const endDate = document.getElementById('endDate').value; // Capture end date from input

//     console.log("Questionnaire User ID:", userId);
//     console.log("Questionnaire Job ID:", jobId);
//     console.log("Questionnaire Start Date:", startDate);
//     console.log("Questionnaire End Date:", endDate);

//     // Validate required fields
//     if (!userId || !jobId || !startDate || !endDate) {
//         console.error("One or more required fields are missing.");
//         alert("Please ensure all fields are filled out correctly before saving.");
//         return;
//     }

//     const feedbackData = {
//         questions: [],
//         skills: [] // Assuming you might want to collect skills later
//     };

//     // Collect qualitative questions from the input fields
//     const feedbackRows = document.querySelectorAll('#feedback-table-body tr');
//     feedbackRows.forEach(row => {
//         const qualitativeInput = row.querySelector('input[name="kraObjectivesInput"]'); // Get qualitative question input

//         if (qualitativeInput && qualitativeInput.value.trim()) { // Ensure input is not empty
//             feedbackData.questions.push({
//                 qualitativeQuestion: qualitativeInput.value.trim() // Save qualitative question
//             });
//         }
//     });

//     // Check if any questions were added
//     if (feedbackData.questions.length === 0) {
//         alert("Please provide at least one qualitative question.");
//         return;
//     }

//     console.log("Feedback data to save:", feedbackData);

//     // Proceed to send the feedback data to the server
//     try {
//         const response = await fetch(`/linemanager/records-performance-tracker/questionnaire/${userId}`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 userId, // Include userId here
//                 jobId,
//                 startDate,
//                 endDate,
//                 feedbackData
//             })
//         });

//         console.log("Response from server:", response);

//         // Check if the response was successful
//         if (!response.ok) {
//             throw new Error(`Server responded with status ${response.status}`);
//         }

//         const result = await response.json();
//         console.log("Result from server:", result);

//         if (result.success) {
//             window.location.href = `/linemanager/records-performance-tracker/${userId}`;
//         } else {
//             alert("Failed to save feedback: " + result.message);
//         }
//     } catch (error) {
//         console.error("Error saving feedback:", error);
//         alert("An error occurred while saving feedback.");
//     }
// }

// function fetchSavedQuestionnaire(userId, quarter) {
//     return fetch(`/linemanager/records-performance-tracker/submitted-data/${userId}?quarter=${quarter}`)
//         .then(response => {
//             if (!response.ok) {
//                 throw new Error(`HTTP error! status: ${response.status}`);
//             }
//             return response.json();
//         })
//         .then(data => {
//             if (data.success) {
//                 return data.questionnaire; // Assuming the response contains the questionnaire data
//             } else {
//                 throw new Error("Failed to fetch saved questionnaire.");
//             }
//         });
// }

// function displayQuestionnaireViewOnly(questionnaire) {
//     const tbody = document.getElementById('feedback-table-body');
    
//     // Clear previous content if needed
//     tbody.innerHTML = ''; // Optional: clear existing rows if you want to refresh the table

//     // Assuming questionnaire.objectives is an array of objectives
//     const objectives = questionnaire.objectives || []; // Get the objectives from the questionnaire

//     objectives.forEach(objective => {
//         const row = document.createElement('tr');

//         // Populate the main row with text display only
//         row.innerHTML = `
//             <td><strong>${objective.objectiveDescrpt || 'N/A'}</strong></td>
//             <td><strong>${objective.objectiveKPI || 'N/A'}</strong></td>
//             <td><strong>${objective.objectiveTarget || 'N/A'}</strong></td>
//             <td><strong>${objective.objectiveUOM || '%'}</strong></td>
//             <td><strong>${(objective.objectiveAssignedWeight * 100) || 'N/A'} %</strong></td>
//         `;

//         tbody.appendChild(row);

//         // Create a new row for the static fields
//         const inputRow = document.createElement('tr');
//         const guideQuestionValue = objective.objectiveQualiQuestion || 'No guide question provided'; // Get the guide question from the objective

//         inputRow.innerHTML = `
//             <td colspan="5">
//                 <div style="margin-bottom: 10px;">
//                     <label for="qualitativeInput"> ▶ Guide Question here for qualitative and quantitative feedback:</label>
//                     <div id="qualitativeInput" style="border: 1px solid #ddd; padding: 8px; width: 100%; box-sizing: border-box; background-color: #f9f9f9;">
//                         ${guideQuestionValue}
//                     </div>
//                 </div>
//                 <div style="margin-bottom: 10px;">
//                     <button type="button" disabled style="background-color: lightgray; color: white; border: none; padding: 8px 12px; cursor: not-allowed; border-radius: 4px;">
//                         View Rater's View
//                     </button>
//                     <div id="ratingSection${tbody.children.length}" style="margin-top: 10px; opacity: 0.5; pointer-events: none;">
//                         <div style="margin-bottom: 10px;">
//                             <label>Quantitative (Rating Scale):</label>
//                             <div style="font-size: 14px; margin-top: 5px;">
//                                 Rate from 1-5 based on how well the individual achieved the target or goal related to the guide question.
//                             </div>
//                             <span style="font-size: 24px;" id="starRating${tbody.children.length}" data-rating="0">
//                                 <i class="fa-solid fa-star" data-value="1"></i>
//                                 <i class="fa-solid fa-star" data-value="2"></i>
//                                 <i class="fa-solid fa-star" data-value="3"></i>
//                                 <i class="fa-solid fa-star" data-value="4"></i>
//                                 <i class="fa-solid fa-star" data-value="5"></i>
//                             </span>
//                         </div>
//                         <div style="margin-bottom: 10px;">
//                             <label>Qualitative (Open-ended):</label>
//                             <div style="font-size: 14px; margin-top: 5px;">
//                                 Provide qualitative feedback on the guide question to assess if the target was achieved.
//                             </div>
//                             <div style="border: 1px solid #ddd; padding: 8px; width: 100%; box-sizing: border-box; background-color: #f9f9f9;">
//                                 No qualitative feedback provided
//                             </div>
//                         </div>
//                     </div>
//                 </div>
//             </td>
//         `;

//         tbody.appendChild(inputRow);
//     });

//     // Update start and end dates if needed
//     // updateStartAndEndDates(questionnaire);
// }
// function displayQuestionnaireEditable(questionnaire) {
//     const tbody = document.getElementById('feedback-table-body');
//     tbody.innerHTML = ''; // Clear previous content

//     // Assuming questionnaire.objectives is an array of objectives
//     const objectives = questionnaire.objectives || []; // Get the objectives from the questionnaire

//     // Display start and end dates
//     const startDateInput = document.getElementById('startDate');
//     const endDateInput = document.getElementById('endDate');
//     startDateInput.value = questionnaire.startDate || '';
//     endDateInput.value = questionnaire.endDate || '';

//     // Determine if the current date is past the start date
//     const currentDate = new Date();
//     const isPastStartDate = new Date(questionnaire.startDate) < currentDate;

//     // Disable inputs if the current date is past the start date
//     if (isPastStartDate) {
//         startDateInput.disabled = true;
//         endDateInput.disabled = true;
//     } else {
//         startDateInput.disabled = false;
//         endDateInput.disabled = false;
//     }

//     objectives.forEach((objective, index) => {
//         const row = document.createElement('tr');

//         // Populate the main row with objective details
//         row.innerHTML = `
//             <td><strong>${objective.objectiveDescrpt || 'N/A'}</strong></td>
//             <td><strong>${objective.objectiveKPI || 'N/A'}</strong></td>
//             <td><strong>${objective.objectiveTarget || 'N/A'}</strong></td>
//             <td><strong>${objective.objectiveUOM || '%'}</strong></td>
//             <td><strong>${(objective.objectiveAssignedWeight * 100) || 'N/A'} %</strong></td>
//         `;
//         tbody.appendChild(row);

//         // Create a new row for the input fields
//         const inputRow = document.createElement('tr');
//         const guideQuestionValue = objective.objectiveQualiQuestion || ''; // Use prefetched value or empty string

//         inputRow.innerHTML = `
//             <td colspan="5">
//                 <div style="margin-bottom: 10px;">
//                     <label for="qualitativeInput${index}"> ▶ Guide Question for qualitative and quantitative feedback:</label>
//                     <input 
//                         id="qualitativeInput${index}" 
//                         type="text" 
//                         placeholder="Input your guide question here." 
//                         name="kraObjectivesInput" 
//                         required 
//                         style="width: 100%; box-sizing: border-box;" 
//                         value="${guideQuestionValue}" 
//                     >
//                 </div>
//                 <div style="margin-bottom: 10px;">
//                     <button type="button" onclick="toggleRatingSection('ratingSection${index}')" style="background-color: gray; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 4px;">
//                         View Rater's View
//                     </button>
//                     <div id="ratingSection${index}" style="display: none; margin-top: 10px;">
//                         <div style="margin-bottom: 10px;">
//                             <label>Quantitative (Rating Scale):</label>
//                             <div style="font-size: 14px; margin-top: 5px;">
//                                 Rate from 1-5 based on how well the individual achieved the target or goal related to the guide question.
//                             </div>
//                             <span style="font-size: 24px; cursor: pointer;" id="starRating${index}" data-rating="0">
//                                 <i class="fa-solid fa-star" data-value="1"></i>
//                                 <i class="fa-solid fa-star" data-value="2"></i>
//                                 <i class="fa-solid fa-star" data-value="3"></i>
//                                 <i class="fa-solid fa-star" data-value="4"></i>
//                                 <i class="fa-solid fa-star" data-value="5"></i>
//                             </span>
//                         </div>
//                         <div style="margin-bottom: 10px;">
//                             <label>Qualitative (Open-ended):</label>
//                             <div style="font-size: 14px; margin-top: 5px;">
//                                 Provide qualitative feedback on the guide question to assess if the target was achieved.
//                             </div>
//                             <input type="text" placeholder="Place your Qualitative feedback here." style="width: 100%; box-sizing: border-box;" readonly>
//                         </div>
//                     </div>
//                 </div>
//             </td>
//         `;
//         tbody.appendChild(inputRow);

//         // Add click event listeners to the stars
//         const stars = document.querySelectorAll(`#starRating${index} .fa-star`);
//         stars.forEach(star => {
//             star.addEventListener('click', function() {
//                 const rating = this.getAttribute('data-value');
//                 const starContainer = document.getElementById(`starRating${index}`);
//                 starContainer.setAttribute('data-rating', rating);
//                 updateStarDisplay(stars, rating);
//             });
//         });
//     });
// }
//     // Initialize the update function on page load
//     // updateStartAndEndDates(questionnaire);


// // function updateStartAndEndDates(questionnaire) {
// //     const startDateInput = document.getElementById('startDate');
// //     const endDateInput = document.getElementById('endDate');
// //     const saveButton = document.getElementById('saveQ1_360Feedback');

// //     // Initial Check: If startDate and endDate are editable
// //     const isEditable = !startDateInput.disabled && !endDateInput.disabled;

// //     if (isEditable && !questionnaire.startDate && !questionnaire.endDate) {
// //         // No existing data and editable: Enable inputs and show save button
// //         startDateInput.value = "";
// //         endDateInput.value = "";
// //         startDateInput.disabled = false;
// //         endDateInput.disabled = false;
// //         saveButton.disabled = false;
// //     } else if (!isEditable || (questionnaire.startDate && questionnaire.endDate)) {
// //         // Existing data or non-editable state: Display values and lock inputs
// //         startDateInput.value = questionnaire.startDate || startDateInput.value;
// //         endDateInput.value = questionnaire.endDate || endDateInput.value;
// //         startDateInput.disabled = true;
// //         endDateInput.disabled = true;
// //         saveButton.disabled = true;
// //     }

// //     // Save Button Action
// //     saveButton.addEventListener('click', function (event) {
// //         if (!startDateInput.value || !endDateInput.value) {
// //             alert("Please provide both start and end dates.");
// //             event.preventDefault(); // Prevent form submission if validation fails
// //             return;
// //         }

// //         // Update questionnaire object
// //         questionnaire.startDate = startDateInput.value;
// //         questionnaire.endDate = endDateInput.value;

// //         // Lock inputs after saving
// //         startDateInput.disabled = true;
// //         endDateInput.disabled = true;
// //         saveButton.disabled = true;
// //     });
// // }




// // function displayQuestionnaireEditable(questionnaire) {
// //     const feedbackTableBody = document.getElementById('feedback-table-body');
// //     feedbackTableBody.innerHTML = ''; // Clear previous content

// //     questionnaire.objectives.forEach(objective => {
// //         const row = document.createElement('tr');
// //         row.innerHTML = `
// //             <td>${objective.objectiveQualiQuestion}</td>
// //             <td><input type="text" value="${objective.response || ''}" name="response_${objective.id}"></td>
// //         `;
// //         feedbackTableBody.appendChild(row);
// //     });

// //     // Display start and end dates
// //     const startDateElement = document.getElementById('start-date');
// //     const endDateElement = document.getElementById('end-date');
// //     startDateElement.textContent = questionnaire.startDate;
// //     endDateElement.textContent = questionnaire.endDate;

// //     // Disable editing if the current date is past the start date
// //     const currentDate = new Date();
// //     if (new Date(questionnaire.startDate) < currentDate) {
// //         startDateElement.textContent = questionnaire.startDate; // Display as text
// //         endDateElement.textContent = questionnaire.endDate; // Display as text
// //         // Disable inputs for objectives
// //         const inputs = feedbackTableBody.querySelectorAll('input');
// //         inputs.forEach(input => input.disabled = true);
// //     }
// // }



// // Function to allow editing of the questionnaire
// function editQuestionnaire() {
//     // Allow the user to edit the questionnaire
//     alert('You can now edit the questionnaire.');

//     // Make the feedback form visible again
//     document.getElementById('feedback-section').style.display = 'block';

//     // Hide the feedback status section and button
//     document.getElementById('feedback-status').style.display = 'none';

//     // Optionally, you could reset form inputs or perform other actions needed for editing:
//     // For example, resetting form fields:
//     document.getElementById('feedbackForm').reset();
// }