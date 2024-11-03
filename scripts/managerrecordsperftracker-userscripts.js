const viewStateElement = document.getElementById('viewState');
const viewState = JSON.parse(viewStateElement.getAttribute('data-viewstate'));
let userId = '<%= user.userId %>'; 
let jobId = '<%= user.jobId %>'; 
let submittedObjectives = viewState.submittedObjectives || []; 

function handleObjectiveClick() {
    updateDisplay();
}


document.addEventListener("DOMContentLoaded", function () {
    const objectivesButton = document.getElementById("objectivesButton"); // Ensure this button exists
    objectivesButton.addEventListener("click", handleObjectiveClick);
});


function updateDisplay() {
    document.getElementById("objective-skill-progress-form").style.display = "none"; 
    document.getElementById("view-only-page").style.display = "none"; 

    if (viewState.viewOnlyStatus.objectivesettings) {
        // Show view-only page only if there are submitted objectives
        if (submittedObjectives.length > 0) {
            displaySubmittedObjectives(submittedObjectives);
            document.getElementById("view-only-page").style.display = "block"; // Show view-only page
        } else {
            // If no objectives, you can show a message or just leave it hidden
            document.getElementById("objective-skill-progress-form").style.display = "block"; // Show the form
        }
    } else {
        showObjectiveForm(); // Always show the form in edit mode
    }
}

function showObjectiveForm() {
    document.getElementById("objective-skill-progress-form").style.display = "block"; // Ensure form is visible
}

function displaySubmittedObjectives(objectives) {
    const tableBody = document.getElementById("view-only-table-body");
    tableBody.innerHTML = ""; // Clear previous content
    objectives.forEach(obj => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${obj.objectiveDescrpt || 'N/A'}</td>
            <td>${obj.objectiveKPI || 'N/A'}</td>
            <td>${obj.objectiveTarget || 'N/A'}</td>
            <td>${obj.objectiveUOM || 'N/A'}</td>
            <td>${obj.objectiveAssignedWeight || 'N/A'} %</td>
        `;
        tableBody.appendChild(row);
    });
}

function removeRow(button) {
    const row = button.parentNode.parentNode;
    row.parentNode.removeChild(row);
    updateTotalWeight(); // Update total weight after removal
}

function addRow() {
    const tableBody = document.getElementById("progress-table-body");
    const newRow = document.createElement("tr");
    newRow.innerHTML = `
        <td><input type="text" placeholder="Enter Objective" name="objectiveDescrpt" required></td>
        <td><input type="text" placeholder="Enter KPI" name="objectiveKPI" required></td>
        <td><input type="text" placeholder="Enter Target" name="objectiveTarget" required></td>
        <td><input type="text" placeholder="Enter UOM" name="objectiveUOM" required></td>
        <td><input type="number" class="weight-input" oninput="updateTotalWeight()" placeholder="Enter Weight (%)" name="objectiveAssignedWeight" min="0" max="100" required></td>
        <td><button type="button" onclick="removeRow(this)">Remove</button></td>
    `;
    tableBody.appendChild(newRow);
}

// Function to update total weight in the form
function updateTotalWeight() {
const weightInputs = document.querySelectorAll(".weight-input");
let totalWeight = 0;

weightInputs.forEach(input => {
    totalWeight += parseFloat(input.value) || 0;
});

document.getElementById("totalWeight").value = totalWeight;
}
