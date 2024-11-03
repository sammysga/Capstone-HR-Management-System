                // Parse viewState back into an object
                const viewStateElement = document.getElementById('viewState');
                const viewState = JSON.parse(viewStateElement.getAttribute('data-viewstate'));
                let userId = '<%= user.userId %>'; // Pass userId from server-side
                let jobId = '<%= user.jobId %>'; // Pass jobId from server-side
                let submittedObjectives = viewState.submittedObjectives || []; // Initialize with submitted objectives
            
                // Function to display submitted objectives in view-only mode
                function displaySubmittedObjectives(objectives) {
                    console.log("Displaying submitted objectives.");
                    const objectivesData = document.getElementById("view-only-table-body"); // Change to the table body element
                    objectivesData.innerHTML = ""; // Clear previous data
            
                    if (objectives && objectives.length > 0) {
                        objectives.forEach(obj => {
                            objectivesData.innerHTML += `
                                <tr>
                                    <td>${obj.objectiveDescrpt || 'N/A'}</td>
                                    <td>${obj.objectiveKPI || 'N/A'}</td>
                                    <td>${obj.objectiveTarget || 'N/A'}</td>
                                    <td>${obj.objectiveUOM || 'N/A'}</td>
                                    <td>${obj.objectiveAssignedWeight || 'N/A'}%</td>
                                </tr>`;
                        });
                    } else {
                        objectivesData.innerHTML = "<tr><td colspan='5'>No objectives found.</td></tr>"; // Adjust for table format
                    }
            
                    // Optionally update the submission date if needed
                    // document.getElementById("submissionDate").textContent = new Date().toLocaleDateString('en-US');
                }
            
                // Function to handle objective click
                function handleObjectiveClick() {
                    console.log("Objective clicked. View only status:", viewState.viewOnlyStatus.objectivesettings);
                    if (!viewState.viewOnlyStatus.objectivesettings) {
                        showObjectiveForm(); // Show form if no objectives data
                    } else {
                        displaySubmittedObjectives(viewState.submittedObjectives); // Display objectives in view-only mode
                        document.getElementById("view-only-page").style.display = "block"; // Ensure view-only page is visible
                        document.getElementById("objective-skill-progress-form").style.display = "none"; // Hide the form
                    }
                }
            
                // Function to show the objective form
                function showObjectiveForm() {
                    console.log("Showing objective form.");
                    const objectiveForm = document.getElementById(" objective-skill-progress-form");
                    if (objectiveForm) { // Ensure the form element exists
                        objectiveForm.style.display = "block"; // Show the form
            
                        // Hide other sections
                        const otherSections = document.querySelectorAll('#view-only-page');
                        otherSections.forEach(section => {
                            section.style.display = "none"; // Hide view-only section
                        });
                    } else {
                        console.error("Objective form element not found.");
                    }
                }
            
                // Function to add a new row in the progress table
                function addRow() {
                    console.log("Adding a new row to the progress table.");
                    const newRow = document.createElement('tr');
                    newRow.innerHTML = `
                        <td><input type="text" placeholder="Enter Objective" name="objectiveDescrpt" required></td>
                        <td><input type="text" placeholder="Enter KPI" name="objectiveKPI" required></td>
                        <td><input type="text" placeholder="Enter Target" name="objectiveTarget" required></td>
                        <td><input type="text" placeholder="Enter UOM" name="objectiveUOM" required></td>
                        <td><input type="number" class="weight-input" oninput="updateTotalWeight()" placeholder="Enter Weight (%)" name="objectiveAssignedWeight" min="0" max="100" required></td>
                        <td><button type="button" onclick="removeRow(this)">Remove</button></td>
                    `;
                    document.getElementById('progress-table-body').appendChild(newRow);
                    updateTotalWeight();
                }
            
                // Function to remove a row from the progress table
                function removeRow(button) {
                    console.log("Removing a row from the progress table.");
                    const row = button.parentElement.parentElement;
                    row.remove();
                    updateTotalWeight();
                }
            
                // Function to update the total weight
                function updateTotalWeight() {
                    const weightInputs = document.querySelectorAll('.weight-input');
                    let totalWeight = 0;
            
                    weightInputs.forEach(input => {
                        const weight = parseFloat(input.value) || 0;
                        totalWeight += weight;
                    });
            
                    document.getElementById("totalWeight").value = totalWeight;
                    console.log("Total weight updated:", totalWeight);
                }
            
                // Function to save objectives
                async function saveObjectives() {
                    const performancePeriod = document.getElementById("performanceDate").textContent;
            
                    const objectives = [];
                    const rows = document.querySelectorAll("#progress-table-body tr");
            
                    rows.forEach(row => {
                        const description = row.querySelector('input[name="objectiveDescrpt"]').value;
                        const kpi = row.querySelector('input[name="objectiveKPI"]').value;
                        const target = row.querySelector('input[name="objectiveTarget"]').value;
                        const uom = row.querySelector('input[name="objectiveUOM"]').value;
                        const weight = parseFloat(row.querySelector('input[name="objectiveAssignedWeight"]').value) || 0;
            
                        if (description && kpi && target && uom && weight) {
                            objectives.push({ objectiveDescrpt: description, objectiveKPI: kpi, objectiveTarget: target, objectiveUOM: uom, objectiveAssignedWeight: weight });
                        }
                    });
            
                    const totalWeight = parseFloat(document.getElementById("totalWeight").value);
                    if (totalWeight !== 100) {
                        alert("Total weight of all objectives must be 100%.");
                        return;
                    }
            
                    if (!document.getElementById("confirmationCheckbox").checked) {
                        alert("Please confirm that the objective weights have been reviewed.");
                        return;
                    }
            
                    try {
                        const response = await fetch(`/linemanager/records-performance-tracker/objectivesetting/${userId}`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ jobId, performancePeriod, objectives })
                        });
            
                        const result = await response.json();
                        if (response.ok && result.success) {
                            alert(result.message);
                            displaySubmittedObjectives(objectives);
                            fetchObjectives(userId);
                        } else {
                            alert("Failed to save objectives: " + result.message);
                        }
                    } catch (error) {
                        alert("An error occurred. Please try again later.");
                    }
                }
            
                // Wait until the DOM is fully loaded
                document.addEventListener("DOMContentLoaded", function () {
                    // Log the values for debugging
                    console.log("Submitted Objectives:", submittedObjectives);
                    console.log("User     ID:", userId);
                    console.log("Job ID:", jobId);
            
                    // Check if we need to display objectives or the form on page load
                    if (viewState.viewOnlyStatus.objectivesettings && submittedObjectives.length > 0) {
                        displaySubmittedObjectives(submittedObjectives);
                        document.getElementById("view-only-page").style.display = "block"; // Ensure view-only page is visible
                    } else {
                        // Initially hide both sections
                        document.getElementById("objective-skill-progress-form").style.display = "none";
                        document.getElementById("view-only-page ").style.display = "none";
                    }
                });