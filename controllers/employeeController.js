const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const employeeController = {
    getEmployeeDashboard: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            res.render('staffpages/employee_pages/employeedashboard');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/staff/login');
        }
    },

   // Fetch user account information from Supabase
   getUserAccount: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null; // Safely access userId
        if (!userId) {
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }

        const { data: user, error } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId)
            .single();

        const { data: staff, error: staffError } = await supabase
            .from('staffaccounts')
            .select(`
                firstName, 
                lastName, 
                departments(deptName), 
                jobpositions(jobTitle)
            `)
            .eq('userId', userId)
            .single();

        if (error || staffError) {
            console.error('Error fetching user or staff details:', error || staffError);
            req.flash('errors', { dbError: 'Error fetching user data.' });
            return res.redirect('/staff/employee/dashboard');
        }

        const userData = {
            ...user,
            firstName: staff.firstName,
            lastName: staff.lastName,
            deptName: staff.departments.deptName,
            jobTitle: staff.jobpositions.jobTitle
        };

        res.render('staffpages/employee_pages/useracc', { user: userData });
    } catch (err) {
        console.error('Error in getUserAccount controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the account page.' });
        res.redirect('/staff/employee/dashboard');
    }
},


// Password reset controller function
resetPassword: async function(req, res) {
    try {
        const userId = req.session.user.userId; // Assuming userId is stored in session
        const { newPassword, confirmPassword } = req.body;

        // Ensure passwords match
        if (newPassword !== confirmPassword) {
            req.flash('errors', { passwordError: 'Passwords do not match.' });
            return res.redirect('/staff/employee/useracc');
        }

        // Hash the new password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update password in database
        const { error } = await supabase
            .from('useraccounts')
            .update({ userPass: hashedPassword })
            .eq('userId', userId);

        if (error) {
            console.error('Error updating password:', error);
            req.flash('errors', { dbError: 'Error updating password.' });
            return res.redirect('/staff/employee/useracc');
        }

        req.flash('success', 'Password updated successfully!');
        res.redirect('/staff/employee/useracc');
    } catch (err) {
        console.error('Error in resetPassword controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the password.' });
        res.redirect('/staff/employee/useracc');
    }
},

updateUserInfo: async function(req, res) {
    try {
        const userId = req.session.user.userId; // Assuming userId is stored in session
        const { firstName, lastName, userEmail } = req.body;

        // Update the user info in both 'useraccounts' and 'staffaccounts' tables
        const { error: userError } = await supabase
            .from('useraccounts')
            .update({ userEmail }) // This line updates the email
            .eq('userId', userId);

        const { error: staffError } = await supabase
            .from('staffaccounts')
            .update({ firstName, lastName })
            .eq('userId', userId);

        if (userError || staffError) {
            console.error('Error updating user information:', userError || staffError);
            req.flash('errors', { dbError: 'Error updating user information.' });
            return res.redirect('/employee/useracc');
        }

        req.flash('success', 'User information updated successfully!');
        res.redirect('/employee/useracc');
    } catch (err) {
        console.error('Error in updateUserInfo controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.redirect('/employee/useracc');
    }
},

getEmployeeObjProg: async function(req, res) {
    try {
        // Get the userId from the session
        const userId = req.session.user ? req.session.user.userId : null;

        // Check if the user is logged in
        if (!userId) {
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }

        console.log('User ID:', userId); // Check the userId
const { data: objectives, error } = await supabase
    .from('objectivesettings_objectives')
    .select('objectiveDescrpt, objectiveKPI, objectiveTarget, objectiveUOM, objectiveAssignedWeight')
    

console.log('Objectives:', objectives); // Check what data is being returned
console.error('Supabase Error:', error); // Check for any errors

        // Handle errors from Supabase query
        if (error) {
            console.error('Error fetching objectives:', error);
            req.flash('errors', { dbError: 'An error occurred while loading the objective-based program page.' });
            return res.redirect('/employee/dashboard');
        }

        // Check if objectives data was retrieved
        if (!objectives || objectives.length === 0) {
            req.flash('errors', { noObjectives: 'No objectives found for this user.' });
        }

        // Render the objective-based program page and pass the fetched data
        res.render('staffpages/employee_pages/employeeobjectivebasedprog', {
            errors: req.flash('errors'),
            objectives: objectives // Pass the data to the template
        });
    } catch (err) {
        // Log and handle any errors that occur
        console.error('Error in getEmployeeObjProg controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the objective-based program page.' });
        res.redirect('/employee/dashboard');
    }
},



getEmployeeSKillsProg: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }
        
        // Render the objective-based program page
        res.render('staffpages/employee_pages/employeeskillsproggapanal', {
            errors: req.flash('errors')
        });
    } catch (err) {
        console.error('Error in getEmployeeObjProg controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the objective-based program page.' });
        res.redirect('/employee/dashboard');
    }
},
getPersInfoCareerProg: async function(req, res) {
    try {
        console.log("Starting getPersInfoCareerProg...");

        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            console.log("User not logged in.");
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }

        console.log(`Fetching user data for userId: ${userId}`);

        // Fetch user email and role from useraccounts table
        const { data: user, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId);

        if (userError) {
            console.error('Error fetching user data:', userError);
            req.flash('errors', { dbError: 'Error fetching user information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        console.log("User data fetched successfully.");

        // Fetch personal information from staffaccounts table
        const { data: staff, error: staffError } = await supabase
            .from('staffaccounts')
            .select('firstName, lastName, phoneNumber, dateOfBirth, emergencyContactName, emergencyContactNumber, employmentType, hireDate, departmentId, jobId, staffId')
            .eq('userId', userId);

        if (staffError) {
            console.error('Error fetching staff data:', staffError);
            req.flash('errors', { dbError: 'Error fetching staff information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        console.log("Staff data fetched successfully.");
        const staffId = staff[0]?.staffId;
        if (!staffId) {
            console.error('Staff ID not found for the user.');
            req.flash('errors', { dbError: 'Staff ID not found.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        console.log(`Fetching degree information for staffId: ${staffId}`);

        // Fetch degree information
        const { data: degrees, error: degreeError } = await supabase
            .from('staffdegrees')
            .select('degreeName, universityName, graduationYear')
            .eq('staffId', staffId);

        console.log("Degree information fetched.");

        // Fetch job title from jobpositions table
        const jobId = staff[0]?.jobId;
        console.log(`Fetching job title for jobId: ${jobId}`);
        const { data: job, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', jobId);

        console.log("Job title fetched.");

        // Fetch department name from departments table
        const { data: department, error: departmentError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', staff[0]?.departmentId);

        console.log("Department information fetched.");

        // Fetch career progression milestones
        const { data: milestones, error: milestonesError } = await supabase
            .from('staffcareerprogression')
            .select('milestoneName, startDate, endDate')
            .eq('staffId', staffId);

        console.log("Career milestones fetched.");

        // Fetch experiences
        const { data: experiences, error: experienceError } = await supabase
            .from('staffexperiences')
            .select('companyName, startDate, endDate')
            .eq('staffId', staffId);

        console.log("Experience data fetched.");

        // Fetch certifications
        const { data: certifications, error: certificationError } = await supabase
            .from('staffcertification')
            .select('certificateName, certDate')
            .eq('staffId', staffId);

        console.log("Certifications fetched.");

        // Check for any data fetch errors
        if (userError || degreeError || jobError || departmentError || milestonesError || experienceError || certificationError) {
            console.error('Error fetching one or more sets of data:', userError, degreeError, jobError, departmentError, milestonesError, experienceError, certificationError);
            req.flash('errors', { dbError: 'Error fetching data.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        // Construct user data
        const userData = {
            userEmail: user[0]?.userEmail || '',
            userRole: user[0]?.userRole || '',
            firstName: staff[0]?.firstName || '',
            lastName: staff[0]?.lastName || '',
            phoneNumber: staff[0]?.phoneNumber || '',
            dateOfBirth: staff[0]?.dateOfBirth || '',
            emergencyContactName: staff[0]?.emergencyContactName || '',
            emergencyContactNumber: staff[0]?.emergencyContactNumber || '',
            employmentType: staff[0]?.employmentType || '',
            hireDate: staff[0]?.hireDate || '',
            jobTitle: job[0]?.jobTitle || '',
            departmentName: department[0]?.deptName || '',
            milestones: milestones || [],
            degrees: degrees || [],
            experiences: experiences || [],
            certifications: certifications || []
        };

        console.log("User data constructed successfully.");

        // Render the personal information and career progression page
        res.render('staffpages/employee_pages/employeepersinfocareerprog', {
            user: userData,
            errors: req.flash('errors')
        });
    } catch (err) {
        console.error('Error in getPersInfoCareerProg controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
        res.redirect('/employee/useracc');
    }
},editPersonalInformation: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        const { firstName, lastName, phone, dateOfBirth, emergencyContactName, emergencyContactNumber } = req.body;

        // Log the data received for debugging
        console.log("Received data for update:", { firstName, lastName, phone, dateOfBirth, emergencyContactName, emergencyContactNumber });

        // Update the user information in Supabase
        const { error } = await supabase
            .from('staffaccounts')
            .update({
                firstName,
                lastName,
                phoneNumber: phone,
                dateOfBirth, // Ensure this is the correct field in your Supabase table
                emergencyContactName,
                emergencyContactNumber
            })
            .eq('userId', userId);

        if (error) {
            console.error('Error updating personal information:', error);
            req.flash('errors', { dbError: 'Error updating personal information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        req.flash('success', { updateSuccess: 'Personal information updated successfully!' });
        res.json({ success: true });
    } catch (err) {
        console.error('Error in editPersonalInformation:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.json({ success: false, error: 'An error occurred while updating the information.' });
    }
},

editCareerProgression: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        const { milestones = [] } = req.body;

        // Delete old career milestones before inserting new ones
        await supabase
            .from('staffcareerprogression')
            .delete()
            .eq('staffId', userId);

        // Insert new milestones
        for (const milestone of milestones) {
            const { milestoneName, startDate, endDate } = milestone;
            await supabase
                .from('staffcareerprogression')
                .upsert({ milestoneName, startDate, endDate, staffId: userId });
        }

        req.flash('success', { updateSuccess: 'Career progression updated successfully!' });
        res.redirect('/employee/employeepersinfocareerprog');
    } catch (err) {
        console.error('Error in editCareerProgression:', err);
        req.flash('errors', { dbError: 'An error occurred while updating career progression.' });
        res.redirect('/employee/employeepersinfocareerprog');
    }
},

editDegreeInformation: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        const { degrees = [] } = req.body;

        // Delete old degrees before inserting new ones
        await supabase
            .from('staffdegrees')
            .delete()
            .eq('staffId', userId);

        // Insert new degrees
        for (const degree of degrees) {
            const { degreeName, universityName, graduationYear } = degree;
            await supabase
                .from('staffdegrees')
                .upsert({ degreeName, universityName, graduationYear, staffId: userId });
        }

        req.flash('success', { updateSuccess: 'Degree information updated successfully!' });
        res.redirect('/employee/employeepersinfocareerprog');
    } catch (err) {
        console.error('Error in editDegreeInformation:', err);
        req.flash('errors', { dbError: 'An error occurred while updating degree information.' });
        res.redirect('/employee/employeepersinfocareerprog');
    }
},

editExperiences: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        const { experiences = [] } = req.body;

        // Delete old experiences before inserting new ones
        await supabase
            .from('staffexperiences')
            .delete()
            .eq('staffId', userId);

        // Insert new experiences
        for (const experience of experiences) {
            const { jobTitle, companyName, startDate, endDate } = experience;
            await supabase
                .from('staffexperiences')
                .upsert({ jobTitle, companyName, startDate, endDate, staffId: userId });
        }

        req.flash('success', { updateSuccess: 'Experience updated successfully!' });
        res.redirect('/employee/employeepersinfocareerprog');
    } catch (err) {
        console.error('Error in editExperience:', err);
        req.flash('errors', { dbError: 'An error occurred while updating experience.' });
        res.redirect('/employee/employeepersinfocareerprog');
    }
},

editCertifications: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        const { certifications = [] } = req.body;

        // Delete old certifications before inserting new ones
        await supabase
            .from('staffcertifications')
            .delete()
            .eq('staffId', userId);

        // Insert new certifications
        for (const certification of certifications) {
            const { certificateName, certDate } = certification;
            await supabase
                .from('staffcertifications')
                .upsert({ certificateName, certDate, staffId: userId });
        }

        req.flash('success', { updateSuccess: 'Certifications updated successfully!' });
        res.redirect('/employee/employeepersinfocareerprog');
    } catch (err) {
        console.error('Error in editCertifications:', err);
        req.flash('errors', { dbError: 'An error occurred while updating certifications.' });
        res.redirect('/employee/employeepersinfocareerprog');
    }
},






updateAllInfo: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // Extract user information from the request body
        const {
            userEmail,
            phone,
            dateOfBirth,
            emergencyContact,
            employmentType,
            department,
            hireDate,
            milestones = [], // Assuming this is an array of milestone objects
            degrees =  [],    // Assuming this is an array of degree objects
            experiences = [], // Assuming this is an array of experience objects
            certifications = [] // Assuming this is an array of certification objects
        } = req.body;

        // Update user account information
        const { error: userError } = await supabase
            .from('staffaccounts')
            .update({
                userEmail,
                phone,
                dateOfBirth,
                emergencyContact
            })
            .eq('userId', userId);

        if (userError) {
            console.error('Error updating user account:', userError);
            req.flash('errors', { dbError: 'Error updating user information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        // Update staff account information
        const { error: staffError } = await supabase
            .from('staffaccounts')
            .update({
                employmentType,
                department,
                hireDate
            })
            .eq('userId', userId);

        if (staffError) {
            console.error('Error updating staff account:', staffError);
            req.flash('errors', { dbError: 'Error updating staff information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        // Update milestones
        for (const milestone of milestones) {
            const { milestoneName, startDate, endDate } = milestone;
            await supabase
                .from('staffcareerprogression')
                .upsert({ milestoneName, startDate, endDate, staffId: userId }); // Assuming staffId is the foreign key
        }

        // Update degrees
        for (const degree of degrees) {
            const { degreeName, universityName, graduationYear } = degree;
            await supabase
                .from('staffdegrees')
                .upsert({ degreeName, universityName, graduationYear, staffId: userId });
        }

        // Update experiences
        for (const experience of experiences) {
            const { jobTitle, companyName, startDate } = experience;
            await supabase
                .from('staffexperiences')
                .upsert({ jobTitle, companyName, startDate, staffId: userId });
        }

        // Update certifications
        for (const certification of certifications) {
            const { certificateName, certDate } = certification;
            await supabase
                .from('staffcertification')
                .upsert({ certificateName, certDate, staffId: userId });
        }

        // Redirect back to the personal information page with success message
        req.flash('success', { updateSuccess: 'User information updated successfully!' });
        res.redirect('/employee/employeepersinfocareerprog');

    } catch (err) {
        console.error('Error in updateUserInfo controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.redirect('/employee/employeepersinfocareerprog');
    }
},

uploadCertification: async function(req, res) {

    try {
        const { certificateName } = req.body; // Certificate name from request body
        const file = req.body.file; // Assuming the file is sent in the request body as base64

        // Convert the base64 file to binary
        const buffer = Buffer.from(file, 'base64');

        // Upload the file to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('certifications') // Replace with your storage bucket name
            .upload(`${Date.now()}_${certificateName}`, buffer, {
                contentType: 'application/pdf', // Adjust based on your file type
                upsert: true,
            });

        if (uploadError) {
            console.error('Error uploading file:', uploadError);
            return res.status(500).json({ error: 'Error uploading file' });
        }

        // Get the public URL of the uploaded file
        const { publicURL, error: urlError } = supabase.storage
            .from('certifications')
            .getPublicUrl(uploadData.path);

        if (urlError) {
            console.error('Error getting public URL:', urlError);
            return res.status(500).json({ error: 'Error retrieving file URL' });
        }

        // Insert certification details into the Supabase database
        const { data, error } = await supabase
            .from('certifications') // Replace with your table name
            .insert([
                {
                    certificateName,
                    certificationImage: publicURL,
                    userId: req.session.userId // Assuming userId is stored in the session
                }
            ]);

        if (error) {
            console.error('Error inserting certification:', error);
            return res.status(500).json({ error: 'Error saving certification' });
        }

        // Redirect to user account page or send success response
        return res.redirect('/employee/employeepersinfocareerprog'); // Adjust the redirect as needed
    } catch (err) {
        console.error('Error uploading certification:', err);
        return res.status(500).json({ error: 'An error occurred while uploading the certification' });
    }
},

// Add this function to your employeeController
updatePersUserInfo: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // Extract user information from the request body
        const { userEmail, phone, dateOfBirth, emergencyContact, employmentType, jobTitle, department, hireDate } = req.body;

        // Update user account information
        const { error: userError } = await supabase
            .from('useraccounts')
            .update({
                userEmail, // Update email
                phone, // Assuming you add a phone field to useraccounts
                dateOfBirth, // Assuming you add a dateOfBirth field to useraccounts
                emergencyContact // Assuming you add an emergencyContact field to useraccounts
            })
            .eq('userId', userId);

        // Check for errors
        if (userError) {
            console.error('Error updating user account:', userError);
            req.flash('errors', { dbError: 'Error updating user information.' });
            return res.redirect('/employee/persinfocareerprog');
        }

        // Update staff account information
        const { error: staffError } = await supabase
            .from('staffaccounts')
            .update({
                employmentType,
                jobTitle,
                department,
                hireDate
            })
            .eq('userId', userId);

        // Check for errors
        if (staffError) {
            console.error('Error updating staff account:', staffError);
            req.flash('errors', { dbError: 'Error updating staff information.' });
            return res.redirect('/staff/employee/persinfocareerprog');
        }

        // Redirect back to the personal information page with success message
        req.flash('success', { updateSuccess: 'User information updated successfully!' });
        res.redirect('/staff/employee/persinfocareerprog');

    } catch (err) {
        console.error('Error in updateUserInfo controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.redirect('/staff/employee/persinfocareerprog');
    }
},

getEmployeeOffboarding: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // Fetch user-specific data if needed, or any offboarding-related details
        const { data: user, error } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId)
            .single();

        if (error) {
            console.error('Error fetching user details:', error);
            req.flash('errors', { dbError: 'Error fetching user data.' });
            return res.redirect('/staff/employee/dashboard');
        }

        // Render the offboarding page
        res.render('staffpages/employee_pages/employeeoffboarding', { user });
    } catch (err) {
        console.error('Error in getEmployeeOffboarding controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the offboarding page.' });
        res.redirect('/staff/employee/dashboard');
    }
},
getLeaveRequestForm: async function(req, res) {
    console.log('Session User:', req.session.user);
    
    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            const userId = req.session.user.userId; // Get userId from the session

            // Fetch active leave types
            const { data: leaveTypes, error: leaveTypesError } = await supabase
                .from('leave_types')
                .select('leaveTypeId, typeName, typeIsActive, typeMaxCount')
                .eq('typeIsActive', true);

            if (leaveTypesError) throw leaveTypesError;

            console.log('Fetched leave types:', leaveTypes);

            // Fetch leave requests for the logged-in employee using userId
            const { data: leaveRequests, error: leaveRequestsError } = await supabase
                .from('leaverequests')
                .select('leave_types(typeName), fromDate, untilDate, status')
                .eq('userId', userId); // Use userId instead of staffId

            if (leaveRequestsError) throw leaveRequestsError;

            console.log('Fetched leave requests:', leaveRequests);

            // Fetch leave balances
            const leaveBalancesPromises = leaveTypes.map(async (leaveType) => {
                // Check if leaveTypeId is defined
                if (!leaveType.leaveTypeId) {
                    console.warn(`Leave Type ID is missing for ${leaveType.typeName}. Defaulting to max count.`);
                    return {
                        typeName: leaveType.typeName,
                        totalLeaves: leaveType.typeMaxCount,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount
                    };
                }

                const { data: balanceData, error: balanceError } = await supabase
                    .from('leavebalances')
                    .select('totalLeaves, usedLeaves, remainingLeaves')
                    .eq('userId', userId) // Use userId instead of staffId
                    .eq('leaveTypeId', leaveType.leaveTypeId)
                    .single();

                if (balanceError || !balanceData) {
                    console.warn(`No balance found for ${leaveType.typeName}. Defaulting to max count.`);
                    return {
                        typeName: leaveType.typeName,
                        totalLeaves: leaveType.typeMaxCount,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount
                    };
                }
                return {
                    typeName: leaveType.typeName,
                    totalLeaves: balanceData.totalLeaves,
                    usedLeaves: balanceData.usedLeaves,
                    remainingLeaves: balanceData.remainingLeaves
                };
            });

            const leaveBalances = await Promise.all(leaveBalancesPromises);
            console.log('Fetched leave balances:', leaveBalances);

            // Render the leave request form
            res.render('staffpages/employee_pages/employeeleaverequest', { leaveTypes, leaveRequests, leaveBalances });
        } catch (error) {
            console.error('Error rendering leave request form:', error);
            req.flash('error', { fetchError: 'Unable to load leave request form.' });
            return res.redirect('/staff/login');
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized access. Employee role required.' });
        res.redirect('/staff/login');
    }
},

submitLeaveRequest: async function(req, res) {
    console.log('Submitting leave request...');
    if (!req.session.user || !req.session.user.userId) { // Check userId
        console.log('Unauthorized access: No session user');
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    const { leaveTypeId, fromDate, untilDate, reason, fromDayType, untilDayType } = req.body;

    if (!leaveTypeId || !fromDate || !untilDate || !reason || !fromDayType || !untilDayType) {
        console.log('Missing fields in leave request submission', req.body);
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const fromDateObj = new Date(fromDate);
        const untilDateObj = new Date(untilDate);
        const daysRequested = Math.ceil((untilDateObj - fromDateObj) / (1000 * 60 * 60 * 24)) + 1;

        console.log(`Days requested: ${daysRequested} from ${fromDate} to ${untilDate}`);

        const { data: balanceData, error: balanceError } = await supabase
            .from('leavebalances')
            .select('usedLeaves, remainingLeaves, totalLeaves')
            .eq('userId', req.session.user.userId) // Use userId
            .eq('leaveTypeId', leaveTypeId)
            .single();

        let totalLeaves, remainingLeaves;
        if (balanceError || !balanceData) {
            const { data: leaveTypeData, error: leaveTypeError } = await supabase
                .from('leave_types')
                .select('typeMaxCount')
                .eq('leaveTypeId', leaveTypeId)
                .single();

            if (leaveTypeError || !leaveTypeData) {
                console.log('Leave type not found or error:', leaveTypeError);
                return res.status(404).json({ message: 'Leave type not found' });
            }
            totalLeaves = leaveTypeData.typeMaxCount;
            remainingLeaves = totalLeaves;
        } else {
            totalLeaves = balanceData.totalLeaves;
            remainingLeaves = balanceData.remainingLeaves;
        }

        console.log(`Total leaves: ${totalLeaves}, Remaining leaves: ${remainingLeaves}`);

        if (remainingLeaves < daysRequested) {
            console.log(`Insufficient leave balance. Remaining: ${remainingLeaves}, Requested: ${daysRequested}`);
            return res.status(400).json({ message: 'Insufficient leave balance for the requested period.' });
        }

        const { error: requestError } = await supabase
            .from('leaverequests')
            .insert([{
                userId: req.session.user.userId, // Change from staffId to userId
                leaveTypeId,
                fromDate,
                untilDate,
                fromDayType,
                untilDayType,
                reason,
                status: 'Pending for Approval'
            }]);

        if (requestError) {
            console.error('Error inserting leave request:', requestError.message);
            return res.status(500).json({ message: 'Failed to submit leave request.' });
        }

        const newUsedLeaves = (balanceData ? balanceData.usedLeaves : 0) + daysRequested;
        const newRemainingLeaves = totalLeaves - newUsedLeaves;

        const { error: upsertError } = await supabase
            .from('leavebalances')
            .upsert({
                userId: req.session.user.userId, // Use userId
                leaveTypeId,
                usedLeaves: newUsedLeaves,
                remainingLeaves: newRemainingLeaves,
                totalLeaves: totalLeaves
            });

        if (upsertError) {
            console.error('Error during leave balance upsert:', upsertError.message);
            return res.status(500).json({ message: 'Failed to update leave balances.' });
        }

        res.status(200).json({ message: 'Leave request submitted successfully.' });
    } catch (error) {
        console.error('Error submitting leave request:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},

getLeaveRequestsByUserId: async function(req, res) {
    console.log('Fetching leave balances for user...');

    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            // Step 1: Fetch active leave types
            const { data: activeLeaveTypes, error: leaveTypesError } = await supabase
                .from('leave_types')
                .select('leaveTypeId, typeName')
                .eq('typeIsActive', true);

            if (leaveTypesError) {
                console.error('Error fetching leave types:', leaveTypesError.message);
                throw leaveTypesError;
            }

            console.log('Fetched active leave types:', activeLeaveTypes);

            // Step 2: Fetch leave balances for the logged-in employee using userId
            const leaveBalancesPromises = activeLeaveTypes.map(async (leaveType) => {
                const { data: leaveBalance, error: balanceError } = await supabase
                    .from('leavebalances')
                    .select('totalLeaves, usedLeaves, remainingLeaves') // Fetch all relevant fields
                    .eq('userId', req.session.user.userId) // Use userId
                    .eq('leaveTypeId', leaveType.leaveTypeId)
                    .single();

                if (balanceError || !leaveBalance) {
                    console.warn(`No leave balance found for ${leaveType.typeName}. Defaulting to max count.`);
                    return {
                        leaveTypeId: leaveType.leaveTypeId,
                        typeName: leaveType.typeName,
                        totalLeaves: leaveType.typeMaxCount,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount
                    };
                }

                return {
                    leaveTypeId: leaveType.leaveTypeId,
                    typeName: leaveType.typeName,
                    totalLeaves: leaveBalance.totalLeaves,
                    usedLeaves: leaveBalance.usedLeaves,
                    remainingLeaves: leaveBalance.remainingLeaves
                };
            });

            const leaveBalances = await Promise.all(leaveBalancesPromises);
            console.log('Fetched leave balances:', leaveBalances);

            // Step 3: Fetch leave requests for the logged-in employee
            const { data: leaveRequests, error: leaveRequestsError } = await supabase
                .from('leaverequests')
                .select('leaveTypeId, fromDate, untilDate, reason, status') // Include reason and status
                .eq('userId', req.session.user.userId) // Use userId
                .order('fromDate', { ascending: false }); // Order by date descending

            if (leaveRequestsError) {
                console.error('Error fetching leave requests:', leaveRequestsError.message);
                throw leaveRequestsError;
            }

            console.log('Fetched leave requests:', leaveRequests);

            res.status(200).json({ leaveBalances, leaveRequests });
        } catch (error) {
            console.error('Error fetching leave balances and requests:', error.message);
            res.status(500).json({ message: 'Internal server error', error: error.message });
        }
    } else {
        console.log('Unauthorized access: No session user or not an employee');
        res.status(401).json({ message: 'Unauthorized access' });
    }
},
postLeaveBalancesByUserId: async function(req, res) {
    console.log('Posting leave balances by user ID...');

    // Check for a valid session user
    if (!req.session.user || !req.session.user.userId) {
        console.log('Unauthorized access: No session user');
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    try {
        // Get the userId from the session
        const userId = req.session.user.userId;

        const { leaveTypeId, usedLeaves, remainingLeaves } = req.body;

        // Validate the required fields
        if (!leaveTypeId || usedLeaves === undefined || remainingLeaves === undefined) {
            console.log('Missing required fields in leave balances:', req.body);
            return res.status(400).json({ message: 'All fields are required.' });
        }

        // Update leave balance for the user
        const { error } = await supabase
            .from('leavebalances')
            .upsert({
                userId: userId, // Use userId instead of staffId
                leaveTypeId,
                usedLeaves,
                remainingLeaves,
            });

        if (error) {
            console.error('Error updating leave balance:', error.message);
            return res.status(500).json({ message: 'Failed to update leave balance.' });
        }

        console.log('Leave balance updated successfully');
        res.status(200).json({ message: 'Leave balance updated successfully.' });
    } catch (error) {
        console.error('Error posting leave balances:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},


// Function to fetch the count of pending leave requests
fetchPendingRequestsCount: async function(req, res) {
    console.log('Fetching count of pending leave requests for user:', req.session.user.userId);

    try {
        const { count, error } = await supabase
            .from('leaverequests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'Pending for Approval')
            .eq('userId', req.session.user.userId);

        if (error) {
            console.error('Error fetching pending requests:', error.message);
            return res.status(500).json({ message: 'Error fetching pending requests', error: error.message });
        }

        console.log('Pending requests count for user:', count);
        return res.status(200).json({ count: count });
    } catch (err) {
        console.error('Error in fetchPendingRequestsCount:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
},

getAttendance: async function (req, res) {
    // Check if the user is authenticated
    if (!req.session.user || !req.session.user.userId) {
        console.log('Unauthorized access, session:', req.session);
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    try {
        // Fetch user details associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, departmentId, firstName, lastName')
            .eq('userId', req.session.user.userId)
            .single();

        if (fetchError) {
            console.error('Fetch Error:', fetchError);
            return res.status(404).json({ message: 'User not found', error: fetchError.message });
        }

        if (!userData) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { staffId, departmentId, firstName, lastName } = userData;

        // Fetch attendance records for the user by userId
        const { data: attendanceRecords, error: attendanceError } = await supabase
            .from('attendance')
            .select('attendanceDate, attendanceTime, attendanceAction')
            .eq('userId', req.session.user.userId) // Changed to filter by userId
            .order('attendanceDate', { ascending: false }); // Order by date descending

        if (attendanceError) {
            console.error('Attendance Fetch Error:', attendanceError);
            throw attendanceError;
        }

        // Get today's date and current time
        const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const currentTime = new Date().toTimeString().split(' ')[0]; // HH:mm:ss

        // Render the attendance page with the attendance records and user details
        res.render('staffpages/employee_pages/employeeattendance', {
            user: {
                staffId,
                departmentId,
                firstName,
                lastName
            },
            records: attendanceRecords || [],
            todayDate, // Pass the todayDate
            currentTime, // Pass the currentTime
            message: 'Attendance records retrieved successfully' // You can include other data as needed
        });

    } catch (error) {
        // Log and respond with error in case of failure
        console.error('Error retrieving attendance records:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},
postAttendance: async function (req, res) {
    // Check if the user is authenticated
    if (!req.session.user || !req.session.user.userId) {
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    // Destructure the relevant fields from the request body
    const { attendanceAction, attendanceTime, selectedDate } = req.body; // Include selectedDate if available

    // Ensure mandatory fields are provided
    if (!attendanceAction || !attendanceTime) {
        return res.status(400).json({ message: 'Attendance action and time are required.' });
    }

    try {
        // Fetch staffId and user details associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, firstName, lastName')
            .eq('userId', req.session.user.userId)
            .single();

        if (fetchError || !userData) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { staffId, firstName, lastName } = userData;

        // Determine the attendance date (use selectedDate or default to yesterday's date)
        const currentDate = new Date();
        const yesterday = new Date(currentDate);
        yesterday.setDate(currentDate.getDate() - 1);  // Set the date to yesterday

        // If no selectedDate is provided, default to yesterday's date
        const attendanceDate = selectedDate || yesterday.toISOString().split('T')[0]; // Use selectedDate or yesterday if not provided

        // Insert the attendance record into the attendance table using userId
        const { error: insertError } = await supabase
            .from('attendance')
            .insert([
                {
                    userId: req.session.user.userId,  // Add userId directly
                    attendanceDate,                   // Use selectedDate or default to yesterday
                    attendanceTime,                   // User-provided time
                    attendanceAction                  // Action: Time In or Time Out
                }
            ]);

        if (insertError) throw insertError;

        // Log the attendance submission
        console.log(`Attendance recorded for: ${firstName} ${lastName} on ${attendanceDate} at ${attendanceTime} as ${attendanceAction}`);

        // Respond with a success message
        res.status(200).json({ message: `Attendance recorded successfully for ${firstName} ${lastName}` });
    } catch (error) {
        // Log and respond with error in case of failure
        console.error('Error recording attendance:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},



getViewPerformanceTimeline: function(req, res){
    if (req.session.user && req.session.user.userRole === 'Employee') {
        res.render('staffpages/employee_pages/employee-viewtimeline');
    } else {
        req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
        res.redirect('/staff/login');
    }
},


// getAttendance: async function (req, res) {
//     // Check if the user is authenticated
//     if (!req.session.user || !req.session.user.userId) {
//         console.log('Unauthorized access, session:', req.session);
//         return res.status(401).json({ message: 'Unauthorized access' });
//     }

//     try {
//         // Fetch staffId, departmentId, firstName, and lastName associated with the userId
//         const { data: userData, error: fetchError } = await supabase
//             .from('staffaccounts')
//             .select('staffId, departmentId, firstName, lastName')
//             .eq('userId', req.session.user.userId)
//             .single();

//         if (fetchError) {
//             console.error('Fetch Error:', fetchError);
//             return res.status(404).json({ message: 'User not found', error: fetchError.message });
//         }

//         if (!userData) {
//             return res.status(404).json({ message: 'User not found' });
//         }

//         const { staffId, departmentId, firstName, lastName } = userData;

//         // Fetch attendance records for the current date or all records
//         const { data: attendanceRecords, error: attendanceError } = await supabase
//             .from('attendance')
//             .select('attendanceDate, attendanceTime, attendanceAction')
//             .eq('staffId', staffId) // Filter by staffId
//             .order('attendanceDate', { ascending: false }); // Order by date descending

//         if (attendanceError) {
//             console.error('Attendance Fetch Error:', attendanceError);
//             throw attendanceError;
//         }

//         // Get today's date and current time
//         const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
//         const currentTime = new Date().toTimeString().split(' ')[0]; // HH:mm:ss

//         // Render the attendance page with the attendance records and user details
//         res.render('staffpages/employee_pages/employeeattendance', {
//             user: {
//                 staffId,
//                 departmentId,
//                 firstName,
//                 lastName
//             },
//             records: attendanceRecords || [],
//             todayDate, // Pass the todayDate
//             currentTime, // Pass the currentTime
//             message: 'Attendance records retrieved successfully' // You can include other data as needed
//         });

//     } catch (error) {
//         // Log and respond with error in case of failure
//         console.error('Error retrieving attendance records:', error);
//         res.status(500).json({ message: 'Internal server error', error: error.message });
//     }
// },


// postAttendance: async function (req, res) {
//     // Check if the user is authenticated
//     if (!req.session.user || !req.session.user.userId) {
//         return res.status(401).json({ message: 'Unauthorized access' });
//     }

//     // Destructure the relevant fields from the request body
//     const { attendanceAction } = req.body; // Expecting attendanceAction (Time In or Time Out)

//     // Ensure mandatory fields are provided
//     if (!attendanceAction) {
//         return res.status(400).json({ message: 'Attendance action is required (Time In or Time Out).' });
//     }

//     try {
//         // Fetch staffId and user details associated with the userId
//         const { data: userData, error: fetchError } = await supabase
//             .from('staffaccounts')
//             .select('staffId, firstName, lastName')
//             .eq('userId', req.session.user.userId)
//             .single();

//         if (fetchError || !userData) {
//             return res.status(404).json({ message: 'User  not found' });
//         }

//         const { staffId, firstName, lastName } = userData;

//         // Get the current date and time
//         const currentDate = new Date();
//         const attendanceDate = currentDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
//         const attendanceTime = currentDate.toTimeString().split(' ')[0]; // Format: HH:MM:SS

//         // Insert the attendance record into the attendance table
//         const { error: insertError } = await supabase
//             .from('attendance')
//             .insert([
//                 {
//                     staffId,              // Foreign key reference to staff
//                     attendanceDate,       // Current date
//                     attendanceTime,       // Current time
//                     attendanceAction      // Action: Time In or Time Out
//                 }
//             ]);

//         if (insertError) throw insertError;

//         // Log the attendance submission
//         console.log(`Attendance recorded for: ${firstName} ${lastName} on ${attendanceDate} at ${attendanceTime} as ${attendanceAction}`);

//         // Respond with a success message
//         res.status(200).json({ message: `Attendance recorded successfully for ${firstName} ${lastName}` });
//     } catch (error) {
//         // Log and respond with error in case of failure
//         console.error('Error recording attendance:', error);
//         res.status(500).json({ message: 'Internal server error', error: error.message });
//     }
// },

};

module.exports = employeeController;
