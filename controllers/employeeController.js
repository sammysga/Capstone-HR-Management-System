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
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        // Render the offboarding page
        res.render('staffpages/employee_pages/employeeoffboarding', { user });
    } catch (err) {
        console.error('Error in getEmployeeOffboarding controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the offboarding page.' });
        res.redirect('/employee/employeepersinfocareerprog');
    }
},

postEmployeeOffboarding: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;

        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        const { message, lastDay } = req.body;

        if (!message || !lastDay) {
            req.flash('errors', { formError: 'Please fill in all required fields.' });
            return res.redirect('employee/employeeoffboarding');
        }

        // Insert details to db
        const { data: offboarding, error: insertError } = await supabase
            .from('offboarding_requests')
            .insert([
                {
                    userId,
                    message,
                    last_day: lastDay,
                    status: 'Pending', // Default status
                },
            ])
            .single();

            console.log(req.body);
        
        if (insertError) {
            console.error('Error inserting offboarding request:', insertError);
            req.flash('errors', { dbError: 'Failed to save resignation details.' });
            return res.redirect('employee/employeeoffboarding');
        }

        req.flash('success', 'Your resignation request has been submitted successfully.');
        res.redirect('/employee/employeepersinfocareerprog');
    } catch (err) {
        console.error('Error in postEmployeeOffboarding controller:', err);
        req.flash('errors', { dbError: 'An error occurred while processing the request.' });
        res.redirect('employee/employeeoffboarding');
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
get360FeedbackToast: async function(req, res) {
    try {
        console.log("Entering get360Feedback function");

        // Step 1: Get today's date in the Philippines Time Zone (PHT) and format it to 'YYYY-MM-DD'
        const today = new Date();
        const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(today);

        const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;

        const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4']; // List of feedback tables
        let activeFeedback = null;

        // Step 2: Fetch the current user's department ID
        const currentUserId = req.session?.user?.userId;

        if (!currentUserId) {
            console.error("Error: No user ID available in session.");
            return res.status(400).json({ message: 'User  ID is required.' });
        }

        const { data: currentUserData, error: userError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', currentUserId)
            .single();

        if (userError || !currentUserData) {
            console.error("Error fetching user details:", userError);
            return res.status(404).json({ message: 'User  details not found.' });
        }

        const { departmentId } = currentUserData;

        // Step 3: Loop through each feedback table (Q1 to Q4) and fetch the active feedback record
        for (const feedbackTable of feedbackTables) {
            console.log(`Fetching data from table: ${feedbackTable}...`);

            const { data, error } = await supabase
                .from(feedbackTable)
                .select('*')
                .gte('setStartDate', todayString) // Ensure setStartDate is today or in the future
                .gt('setEndDate', todayString); // Ensure setEndDate is in the future

            if (error) {
                console.error(`Error fetching data from ${feedbackTable}:`, error);
                continue; // Skip to the next table if there's an error with the current table
            }

            // Check if data is found and set activeFeedback
            if (data && data.length > 0) {
                console.log(`Data fetched from ${feedbackTable}:`, data);

                // Step 4: Filter userIds to only include those in the same department
                const departmentUserIds = [];

                for (const record of data) {
                    const { data: userData, error: userFetchError } = await supabase
                        .from('staffaccounts')
                        .select('departmentId')
                        .eq('userId', record.userId)
                        .single();

                    if (userFetchError || !userData) {
                        console.error("Error fetching user details:", userFetchError);
                        continue; // Skip if there's an error
                    }

                    if (userData.departmentId === departmentId) {
                        departmentUserIds.push(record); // Store the entire record if the department matches
                    }
                }

                if (departmentUserIds.length > 0) {
                    activeFeedback = departmentUserIds[0]; // Assuming only one active feedback per table
                    break; // Stop searching once an active feedback is found
                } else {
                    console.log(`No active feedback found for the current user's department in ${feedbackTable}.`);
                }
            } else {
                console.log(`No data found in ${feedbackTable}.`);
            }
        }

        // Ensure the logic is correct for date matching
        console.log(`Today's Date: ${todayString}`);
        console.log('Active Feedback Record:', activeFeedback);

        // Step 5: Check if any active feedback record was found
        if (!activeFeedback) {
            console.log('No active feedback records found for the given date range.');
            return res.status(404).json({ success: false, message: 'No active feedback records found for the given date range.' });
        }

        // Step 6: Return the active feedback record
        console.log('Active feedback found:', activeFeedback);

        // Assuming the quarter is fetched from the record
        const quarter = activeFeedback.quarter; // Adjust to get the actual quarter from the data

        return res.status(200).json({ success: true, feedback: activeFeedback, quarter });

    } catch (error) {
        console.error('Error in get360Feedback:', error);
        return res.status(500).json({ success: false, message: 'An error occurred while fetching feedback data.', error: error.message });
    }
},

getFeedbackUsers: async function(req, res) {
    const currentUserId = req.session?.user?.userId;
    const quarter = req.query.quarter || null;

    if (!currentUserId) {
        console.error("Error: No user ID available in session.");
        return res.status(400).json({ message: 'User  ID is required.' });
    }

    try {
        // Fetch current user data
        const { data: currentUserData, error: userError } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName, 
                departmentId, 
                jobId,
                departments (deptName),
                jobpositions (jobTitle)
            `)
            .eq('userId', currentUserId)
            .single();

        if (userError || !currentUserData) {
            console.error("Error fetching user details:", userError);
            return res.status(404).json({ message: 'User  details not found.' });
        }

        console.log("Fetched current user data:", currentUserData);

        const { departmentId, jobpositions: { jobTitle } = {}, departments: { deptName } = {} } = currentUserData;

        if (!departmentId) {
            console.error("Error: No department ID found.");
            return res.status(404).json({ message: 'Department ID not found for the user.' });
        }

        // Get today's date in the Philippines Time Zone (PHT)
        const today = new Date();
        const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(today);
        const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;

        console.log("Today's date (PHT):", todayString);

        // Define feedback tables and their corresponding ID fields
        const feedbackTables = [
            { name: 'feedbacks_Q1', idField: 'feedbackq1_Id' },
            { name: 'feedbacks_Q2', idField: 'feedbackq2_Id' },
            { name: 'feedbacks_Q3', idField: 'feedbackq3_Id' },
            { name: 'feedbacks_Q4', idField: 'feedbackq4_Id' }
        ];
        let usersInDepartment = new Set(); // To store unique user IDs
        let feedbackList = [];

        // Fetch all user IDs from the feedback tables
        for (const { name, idField } of feedbackTables) {
            console.log(`Fetching data from table: ${name}...`);

            const { data, error } = await supabase
                .from(name)
                .select(`userId, setStartDate, setEndDate, ${idField}`)
                .gte('setStartDate', todayString)
                .gt('setEndDate', todayString);

            if (error) {
                console.error(`Error fetching data from ${name}:`, error);
                continue; // Skip if there's an error
            }

            console.log(`Fetched ${data.length} records from ${name}:`, data);
            if (data && data.length > 0) {
                data.forEach(record => {
                    usersInDepartment.add(record.userId);
                    feedbackList.push({ ...record, sourceTable: name, feedbackIdField: idField });
                });
            }
        }

        if (usersInDepartment.size === 0) {
            console.warn("No feedback data found.");
            return res.status(404).json({ message: 'No feedback data found.' });
        }

        // Convert Set back to Array
        const usersArray = Array.from(usersInDepartment);
        console.log("Users in department:", usersArray);

        // Fetch user details for all users in the department
       
        const { data: usersDetails, error: usersError } = await supabase
            .from('staffaccounts')
            .select('userId, firstName, lastName')
            .in('userId', usersArray);

        if (usersError) {
            console.error("Error fetching user details:", usersError);
            return res.status(500).json({ message: 'Error fetching user details.' });
        }

        console.log("Fetched user details for department:", usersDetails);

        // Initialize feedbackDetails array
        let feedbackDetails = [];

        for (const feedback of feedbackList) {
            const feedbackIdValue = feedback[feedback.feedbackIdField];

            console.log(`Feedback Record:`, feedback);
            console.log(` Source Table: ${feedback.sourceTable}`);
            console.log(`Feedback ID Field: ${feedback.feedbackIdField}`);
            console.log(`Feedback ID Value: ${feedbackIdValue}`);

            if (!feedbackIdValue) {
                console.error(`Error: Feedback ID is undefined for record:`, feedback);
                continue;
            }

            // Fetch linked objectives for the feedback
            const { data: objectives, error: objectivesError } = await supabase
                .from('feedbacks_questions-objectives')
                .select('objectiveId, objectiveQualiQuestion')
                .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

            if (objectivesError) {
                console.error(`Error fetching objectives for feedback ID ${feedbackIdValue}:`, objectivesError);
                continue;
            }

            console.log(`Fetched ${objectives.length} objectives for feedback ID ${feedbackIdValue}:`, objectives);

            // Fetch linked skills for the feedback
            const { data: skills, error: skillsError } = await supabase
                .from('feedbacks_questions-skills')
                .select('jobReqSkillId')
                .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

            if (skillsError) {
                console.error(`Error fetching skills for feedback ID ${feedbackIdValue}:`, skillsError);
                continue;
            }

            console.log(`Fetched ${skills.length} skills for feedback ID ${feedbackIdValue}:`, skills);

            // Fetch additional details for objectives
            const objectiveIds = objectives.map(obj => obj.objectiveId);
            let objectiveDetails = [];
            if (objectiveIds.length > 0) {
                const { data: objectiveSettings, error: objectiveError } = await supabase
                    .from('objectivesettings_objectives')
                    .select('*')
                    .in('objectiveId', objectiveIds);

                if (objectiveError) {
                    console.error('Error fetching objective settings:', objectiveError);
                } else {
                    objectiveDetails = objectiveSettings;
                    console.log(`Fetched objective details for IDs ${objectiveIds}:`, objectiveDetails);
                }
            }

            // Fetch additional details for skills
            const skillIds = skills.map(skill => skill.jobReqSkillId);
            let skillDetails = [];
            if (skillIds.length > 0) {
                const { data: jobSkills, error: skillError } = await supabase
                    .from('jobreqskills')
                    .select('*')
                    .in('jobReqSkillId', skillIds);

                if (skillError) {
                    console.error('Error fetching job skills:', skillError);
                } else {
                    skillDetails = jobSkills;
                    console.log(`Fetched skill details for IDs ${skillIds}:`, skillDetails);
                }
            }

            feedbackDetails.push({
                feedback,
                objectives,
                skills,
                objectiveDetails,
                skillDetails
            });
        }

        // Render the EJS template with the user and feedback details
        return res.render('staffpages/employee_pages/employeefeedbackquestionnaire', {
            user: {
                userId: currentUserId,
                firstName: currentUserData.firstName,
                lastName: currentUserData.lastName,
                jobTitle: jobTitle,
                deptName: deptName,
                departmentId: departmentId
            },
            usersArray: usersDetails,
            feedbackDetails
        });
    } catch (error) {
        console.error('Error in getFeedbackUsers:', error);
        return res.status(500).json({ success: false, message: 'An error occurred while fetching feedback data.', error: error.message });
    }
},
get360FeedbackList: async function (req, res) {
    const currentUserId = req.session?.user?.userId;
    const quarter = req.query.quarter || null;

    if (!currentUserId) {
        console.error("Error: No user ID available in session.");
        return res.status(400).json({ message: 'User ID is required.' });
    }

    try {
        // Fetch current user data
        const { data: currentUserData, error: userError } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName, 
                departmentId, 
                jobId,
                departments (deptName),
                jobpositions (jobTitle)
            `)
            .eq('userId', currentUserId)
            .single();

        if (userError || !currentUserData) {
            console.error("Error fetching user details:", userError);
            return res.status(404).json({ message: 'User details not found.' });
        }

        const { departmentId, jobId, jobpositions: { jobTitle } = {}, departments: { deptName } = {} } = currentUserData;

        if (!departmentId || !jobId) {
            console.error("Error: Department ID or Job ID not found.");
            return res.status(404).json({ message: 'Department or Job ID not found for the user.' });
        }

        // Get today's date in the Philippines Time Zone (PHT)
        const today = new Date();
        const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(today);
        const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;

        // Define feedback tables and their corresponding ID fields
        const feedbackTables = [
            { name: 'feedbacks_Q1', idField: 'feedbackq1_Id' },
            { name: 'feedbacks_Q2', idField: 'feedbackq2_Id' },
            { name: 'feedbacks_Q3', idField: 'feedbackq3_Id' },
            { name: 'feedbacks_Q4', idField: 'feedbackq4_Id' }
        ];
        let feedbackList = [];

        // Fetch feedback data from each feedback table
        for (const { name, idField } of feedbackTables) {
            const { data, error } = await supabase
                .from(name)
                .select(`userId, setStartDate, setEndDate, ${idField}`)
                .gte('setStartDate', todayString)
                .gt('setEndDate', todayString);

            if (error) {
                console.error(`Error fetching data from ${name}:`, error);
                continue; // Skip if there's an error
            }

            if (data && data.length > 0) {
                data.forEach(record => {
                    feedbackList.push({ ...record, sourceTable: name, feedbackIdField: idField });
                });
            }
        }

        if (feedbackList.length === 0) {
            console.warn("No feedback data found.");
            return res.status(404).json({ message: 'No feedback data found.' });
        }

        // Initialize feedbackDetails array
        let feedbackDetails = [];

        for (const feedback of feedbackList) {
            const feedbackIdValue = feedback[feedback.feedbackIdField];
            if (!feedbackIdValue) {
                console.error(`Error: Feedback ID is undefined for record:`, feedback);
                continue;
            }

            // Fetch linked objectives and skills
            const { data: objectives, error: objectivesError } = await supabase
                .from('feedbacks_questions-objectives')
                .select('objectiveId, objectiveQualiQuestion')
                .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

            const { data: skills, error: skillsError } = await supabase
                .from('feedbacks_questions-skills')
                .select('jobReqSkillId')
                .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

            if (objectivesError || skillsError) {
                console.error(`Error fetching objectives or skills for feedback ID ${feedbackIdValue}:`, objectivesError || skillsError);
                continue;
            }

            // Fetch additional details for objectives
            const objectiveIds = objectives.map(obj => obj.objectiveId);
            let objectiveDetails = [];
            if (objectiveIds.length > 0) {
                const { data: objectiveSettings, error: objectiveError } = await supabase
                    .from('objectivesettings_objectives')
                    .select('*')
                    .in('objectiveId', objectiveIds);

                if (!objectiveError) {
                    objectiveDetails = objectiveSettings;
                }
            }

            // Fetch additional details for skills
            const skillIds = skills.map(skill => skill.jobReqSkillId);
            let skillDetails = [];
            if (skillIds.length > 0) {
                const { data: jobSkills, error: skillError } = await supabase
                    .from('jobreqskills')
                    .select('*')
                    .in('jobReqSkillId', skillIds);

                if (!skillError) {
                    skillDetails = jobSkills;
                }
            }

            // Add submitted objectives
            const submittedObjectives = objectiveDetails.map(obj => ({
                objectiveId: obj.objectiveId,
                description: obj.objectiveDescription,
                status: obj.objectiveStatus
            }));

            feedbackDetails.push({
                feedback,
                objectives,
                skills,
                objectiveDetails,
                skillDetails,
                submittedObjectives
            });
        }

        // Fetch all job requirement skills for classification
        const { data: allSkillsData, error: allSkillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillType, jobReqSkillName')
            .eq('jobId', jobId);

        if (allSkillsError) {
            console.error('Error fetching job requirement skills:', allSkillsError);
            return res.status(500).json({ message: 'Error fetching job requirement skills.' });
        }

        const hardSkills = allSkillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
        const softSkills = allSkillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];

        // Return response
        return res.status(200).json({
            success: true,
            user: currentUserData,
            feedbackDetails,
            hardSkills,
            softSkills,
            quarter: feedbackDetails[0]?.feedback?.quarter || 'No quarter available'
        });

    } catch (error) {
        console.error('Error in get360FeedbackList:', error);
        return res.status(500).json({ message: 'An error occurred while fetching feedback data.', error: error.message });
    }
},

// get360FeedbackList: async function (req, res) {
//     const currentUserId = req.session?.user?.userId;
//     const selectedUserId = req.query.userId; // Get the userId from the query parameters

//     if (!currentUserId) {
//         console.error("Error: No user ID available in session.");
//         return res.status(400).json({ message: 'User  ID is required.' });
//     }

//     try {
//         // Fetch current user data
//         const { data: currentUserData, error: userError } = await supabase
//             .from('staffaccounts')
//             .select(`
//                 userId, 
//                 firstName, 
//                 lastName, 
//                 departmentId, 
//                 jobId,
//                 departments (deptName),
//                 jobpositions (jobTitle)
//             `)
//             .eq('userId', currentUserId)
//             .single();

//         if (userError || !currentUserData) {
//             console.error("Error fetching user details:", userError);
//             return res.status(404).json({ message: 'User  details not found.' });
//         }

//         const { departmentId, jobpositions: { jobTitle } = {}, departments: { deptName } = {} } = currentUserData;

//         // Get today's date in the Philippines Time Zone (PHT)
//         const today = new Date();
//         const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
//         const formatter = new Intl.DateTimeFormat('en-US', options);
//         const parts = formatter.formatToParts(today);
//         const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;

//         // Define feedback tables and their corresponding ID fields
//         const feedbackTables = [
//             { name: 'feedbacks_Q1', idField: 'feedbackq1_Id' },
//             { name: 'feedbacks_Q2', idField: 'feedbackq2_Id' },
//             { name: 'feedbacks_Q3', idField: 'feedbackq3_Id' },
//             { name: 'feedbacks_Q4', idField: 'feedbackq4_Id' }
//         ];

//         let feedbackList = [];
//         let activeUserIds = new Set(); // To store unique user IDs from feedback records

//         // Fetch active feedback data for users in the same department
//         for (const { name, idField } of feedbackTables) {
//             const { data, error } = await supabase
//                 .from(name)
//                 .select(`userId, setStartDate, setEndDate, ${idField}`)
//                 .gte('setStartDate', todayString) // Ensure setStartDate is today or in the future
//                 .gt('setEndDate', todayString); // Ensure setEndDate is in the future

//             if (error) {
//                 console.error(`Error fetching data from ${name}:`, error);
//                 continue; // Skip if there's an error
//             }

//             // Filter records to include only those in the current user's department
//             const filteredData = data.filter(record => record.userId === currentUserId || record.departmentId === departmentId);
//             feedbackList.push(...filteredData.map(record => ({ ...record, sourceTable: name, feedbackIdField: idField })));

//             // Add user IDs to the Set
//             filteredData.forEach(record => activeUserIds.add(record.userId));
//         }

//         // Convert Set back to Array
//         const usersArray = Array.from(activeUserIds);

//         // If a user is selected, filter feedback for that user
//         if (selectedUserId) {
//             feedbackList = feedbackList.filter(feedback => feedback.userId === selectedUserId);
//         }

//         // Initialize feedbackDetails array
//         let feedbackDetails = [];

//         for (const feedback of feedbackList) {
//             const feedbackIdValue = feedback[feedback.feedbackIdField];

//             if (!feedbackIdValue) {
//                 console.error(`Error : Feedback ID is undefined for record:`, feedback);
//                 continue;
//             }

//             // Fetch linked objectives for the feedback
//             const { data: objectives, error: objectivesError } = await supabase
//                 .from('feedbacks_questions-objectives')
//                 .select('objectiveId, objectiveQualiQuestion')
//                 .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

//             if (objectivesError) {
//                 console.error(`Error fetching objectives for feedback ID ${feedbackIdValue}:`, objectivesError);
//                 continue;
//             }

//             // Fetch linked skills for the feedback
//             const { data: skills, error: skillsError } = await supabase
//                 .from('feedbacks_questions-skills')
//                 .select('jobReqSkillId')
//                 .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

//             if (skillsError) {
//                 console.error(`Error fetching skills for feedback ID ${feedbackIdValue}:`, skillsError);
//                 continue;
//             }

//             // Fetch additional details for objectives
//             const objectiveIds = objectives.map(obj => obj.objectiveId);
//             let objectiveDetails = [];
//             if (objectiveIds.length > 0) {
//                 const { data: objectiveSettings, error: objectiveError } = await supabase
//                     .from('objectivesettings_objectives')
//                     .select('*')
//                     .in('objectiveId', objectiveIds);

//                 if (objectiveError) {
//                     console.error('Error fetching objective settings:', objectiveError);
//                 } else {
//                     objectiveDetails = objectiveSettings;
//                 }
//             }

//             // Fetch additional details for skills
//             const skillIds = skills.map(skill => skill.jobReqSkillId);
//             let skillDetails = [];
//             if (skillIds.length > 0) {
//                 const { data: jobSkills, error: skillError } = await supabase
//                     .from('jobreqskills')
//                     .select('*')
//                     .in('jobReqSkillId', skillIds);

//                 if (skillError) {
//                     console.error('Error fetching job skills:', skillError);
//                 } else {
//                     skillDetails = jobSkills;
//                 }
//             }

//             feedbackDetails.push({
//                 feedback,
//                 objectives,
//                 skills,
//                 objectiveDetails,
//                 skillDetails
//             });
//         }

//         // Fetch all users in the same department
//         const { data: allUsersArray, error: usersError } = await supabase
//             .from('staffaccounts')
//             .select('userId, firstName, lastName')
//             .eq('departmentId', departmentId);

//         if (usersError) {
//             console.error("Error fetching users in the same department:", usersError);
//             return res.status(500).json({ message: 'Error fetching users.' });
//         }

//         // Render the EJS template with the user and feedback details
//         return res.render('staffpages/employee_pages/employeefeedbackquestionnaire', {
//             user: {
//                 userId: currentUserId,
//                 firstName: currentUserData.firstName,
//                 lastName: currentUserData.lastName,
//                 jobTitle: jobTitle,
//                 deptName: deptName,
//                 departmentId: departmentId
//             },
//             usersArray: allUsersArray, // Pass all users in the same department
//             feedbackDetails // Pass feedback details for the selected user (if any)
//         });
//     } catch (error) {
//         console.error('Error in get360FeedbackList:', error);
//         return res.status(500).json({ success: false, message: 'An error occurred while fetching feedback data.', error: error.message });
//     }
// },
// get360FeedbackList: async function (req, res) {
//     const currentUserId = req.session?.user?.userId;
//     const selectedUserId = req.query.userId; // Get selected user ID from query

//     if (!currentUserId) {
//         console.error("Error: No user ID available in session.");
//         return res.status(400).json({ message: 'User  ID is required.' });
//     }

//     try {
//         // Fetch current user data
//         const { data: currentUserData, error: userError } = await supabase
//             .from('staffaccounts')
//             .select(`
//                 userId, 
//                 firstName, 
//                 lastName, 
//                 departmentId, 
//                 jobId,
//                 departments (deptName),
//                 jobpositions (jobTitle)
//             `)
//             .eq('userId', currentUserId)
//             .single();

//         if (userError || !currentUserData) {
//             console.error("Error fetching user details:", userError);
//             return res.status(404).json({ message: 'User  details not found.' });
//         }

//         const { departmentId, jobpositions: { jobTitle } = {}, departments: { deptName } = {} } = currentUserData;

//         if (!departmentId) {
//             console.error("Error: No department ID found.");
//             return res.status(404).json({ message: 'Department ID not found for the user.' });
//         }

//         // Get today's date in the Philippines Time Zone (PHT)
//         const today = new Date();
//         const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
//         const formatter = new Intl.DateTimeFormat('en-US', options);
//         const parts = formatter.formatToParts(today);
//         const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;

//         // Define feedback tables and their corresponding ID fields
//         const feedbackTables = [
//             { name: 'feedbacks_Q1', idField: 'feedbackq1_Id' },
//             { name: 'feedbacks_Q2', idField: 'feedbackq2_Id' },
//             { name: 'feedbacks_Q3', idField: 'feedbackq3_Id' },
//             { name: 'feedbacks_Q4', idField: 'feedbackq4_Id' }
//         ];
//         let feedbackList = [];

//         // Fetch feedback data for the selected user
//         for (const { name, idField } of feedbackTables) {
//             const { data, error } = await supabase
//                 .from(name)
//                 .select(`userId, setStartDate, setEndDate, ${idField}`)
//                 .eq('userId', selectedUserId) // Filter by selected user ID
//                 .gte('setStartDate', todayString)
//                 .gt('setEndDate', todayString);

//             if (error) {
//                 console.error(`Error fetching data from ${name}:`, error);
//                 continue; // Skip if there's an error
//             }

//             if (data && data.length > 0) {
//                 data.forEach(record => {
//                     feedbackList.push({ ...record, sourceTable: name, feedbackIdField: idField });
//                 });
//             }
//         }

//         if (feedbackList.length === 0) {
//             console.warn("No feedback data found for the selected user.");
//             return res.status(404).json({ message: 'No feedback data found for the selected user.' });
//         }

//         // Initialize feedbackDetails array ```javascript
//         let feedbackDetails = [];

//         for (const feedback of feedbackList) {
//             const feedbackIdValue = feedback[feedback.feedbackIdField];

//             if (!feedbackIdValue) {
//                 console.error(`Error: Feedback ID is undefined for record:`, feedback);
//                 continue;
//             }

//             // Fetch linked objectives for the feedback
//             const { data: objectives, error: objectivesError } = await supabase
//                 .from('feedbacks_questions-objectives')
//                 .select('objectiveId, objectiveQualiQuestion')
//                 .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

//             if (objectivesError) {
//                 console.error(`Error fetching objectives for feedback ID ${feedbackIdValue}:`, objectivesError);
//                 continue;
//             }

//             // Fetch linked skills for the feedback
//             const { data: skills, error: skillsError } = await supabase
//                 .from('feedbacks_questions-skills')
//                 .select('jobReqSkillId')
//                 .or(`feedbackq1_Id.eq.${feedbackIdValue},feedbackq2_Id.eq.${feedbackIdValue},feedbackq3_Id.eq.${feedbackIdValue},feedbackq4_Id.eq.${feedbackIdValue}`);

//             if (skillsError) {
//                 console.error(`Error fetching skills for feedback ID ${feedbackIdValue}:`, skillsError);
//                 continue;
//             }

//             feedbackDetails.push({
//                 feedback,
//                 objectives,
//                 skills
//             });
//         }

//         // Render the EJS template with the user and feedback details
//         return res.render('staffpages/employee_pages/employeefeedbackquestionnaire', {
//             user: {
//                 userId: selectedUserId,
//                 firstName: currentUserData.firstName,
//                 lastName: currentUserData.lastName,
//                 jobTitle: jobTitle,
//                 deptName: deptName,
//                 departmentId: departmentId
//             },
//             usersArray: usersDetails,
//             feedbackDetails
//         });
//     } catch (error) {
//         console.error('Error in get360FeedbackList:', error);
//         return res.status(500).json({ success: false, message: 'An error occurred while fetching feedback data.', error: error.message });
//     }
// },
getLogoutButton: function(req, res) {
    req.session.destroy(err => {
        if(err) {
            console.error('Error destroying session', err);
            return res.status(500).json({ error: 'Failed to log out. Please try again.' });
        }
        res.redirect('/staff/login');
    });
},

};

module.exports = employeeController;
           
// get360FeedbackList: async function(currentUserId, todayString) {
//     try {
//         // Fetch the department of the current user
//         const { data: currentUserData, error: userError } = await supabase
//             .from('staffaccounts')
//             .select('departmentId')
//             .eq('userId', currentUserId)
//             .single();

//         if (userError) throw userError;

//         const departmentId = currentUserData.departmentId;

//         // Fetch all users in the same department
//         const { data: departmentUsers, error: departmentError } = await supabase
//             .from('staffaccounts')
//             .select('userId')
//             .eq('departmentId', departmentId);

//         if (departmentError) throw departmentError;

//         const usersInDepartment = departmentUsers.map(user => user.userId);

//         // Fetch feedback for each quarter (Q1, Q2, Q3, Q4) for users in the department
//         const feedbackQueries = ['Q1', 'Q2', 'Q3', 'Q4'].map(quarter =>
//             supabase
//                 .from(`feedbacks_${quarter}`)
//                 .select('*')
//                 .in('userId', usersInDepartment)
//                 .gte('setStartDate', todayString)
//                 .lte('setEndDate', todayString)
//         );

//         // Execute all queries simultaneously
//         const feedbackResults = await Promise.all(feedbackQueries);

//         // Fetch objectives and skills for the corresponding feedbacks
//         const { data: objectivesData, error: objectivesError } = await supabase
//             .from('feedbacks_questions-objectives')
//             .select('*');
//         if (objectivesError) throw objectivesError;

//         const { data: skillsData, error: skillsError } = await supabase
//             .from('feedbacks_questions-skills')
//             .select('*');
//         if (skillsError) throw skillsError;

//         // Combine feedback results with their corresponding objectives and skills
//         const feedbackList = feedbackResults.map((feedbackResult, index) => {
//             const quarter = index + 1;
//             const feedbacks = feedbackResult.data || [];
//             return feedbacks.map(feedback => ({
//                 ...feedback,
//                 objectives: objectivesData.filter(obj => obj[`feedbackq${quarter}_Id`] === feedback[`feedbackq${quarter}_Id`]),
//                 skills: skillsData.filter(skill => skill[`feedbackq${quarter}_Id`] === feedback[`feedbackq${quarter}_Id`]),
//             }));
//         }).flat(); // Flatten the result array into a single array

//         return feedbackList;
//     } catch (error) {
//         console.error("Error fetching 360 feedback:", error);
//         return [];
//     }
// },

// get360FeedbackList: async function (req, res) {
//     const { userId, quarter } = req.query; // Expecting data passed via query parameters.

//     try {
//         console.log("Entering get360FeedbackList function");
    
//         if (!userId || !quarter) {
//             console.error("Missing required parameters: userId or quarter");
//             return res.status(400).json({
//                 success: false,
//                 message: "User ID and quarter are required.",
//             });
//         }
    
//         // Define the quarterly feedback tables dynamically based on the quarter
//         const feedbackTable = `feedbacks_${quarter}`;
//         const feedbackKey = `feedback${quarter.toLowerCase()}_Id`;
    
//         console.log(`Fetching data from table: ${feedbackTable}...`);
//         const { data: feedbacks, error: feedbackFetchError } = await supabase
//             .from(feedbackTable)
//             .select('*')
//             .eq('userId', userId);
    
//         if (feedbackFetchError) {
//             console.error("Error fetching feedbacks:", feedbackFetchError.message);
//             return res.status(500).json({
//                 success: false,
//                 message: "Error fetching feedbacks.",
//                 error: feedbackFetchError.message,
//             });
//         }
    
//         if (!feedbacks || feedbacks.length === 0) {
//             console.log("No feedback records found for the given parameters.");
//             return res.status(404).json({
//                 success: false,
//                 message: "No feedback records found.",
//             });
//         }
    
//         const feedbackIds = feedbacks.map(fb => fb[feedbackKey]);
    
//         console.log("Fetching objectives and skills...");
//         const { data: objectives, error: objectivesFetchError } = await supabase
//             .from('feedbacks_questions-objectives')
//             .select('*')
//             .in(feedbackKey, feedbackIds);
    
//         const { data: skills, error: skillsFetchError } = await supabase
//             .from('feedbacks_questions-skills')
//             .select('*')
//             .in(feedbackKey, feedbackIds);
    
//         if (objectivesFetchError || skillsFetchError) {
//             console.error("Error fetching objectives or skills.");
//             return res.status(500).json({
//                 success: false,
//                 message: "Error fetching objectives or skills.",
//             });
//         }
    
//         // Fetch the department of the given user
//         const { data: userDepartment, error: departmentFetchError } = await supabase
//             .from('staffaccounts')
//             .select('departmentId')
//             .eq('userId', userId)
//             .single(); // Assuming userId is unique
    
//         if (departmentFetchError || !userDepartment) {
//             console.error("Error fetching department:", departmentFetchError?.message || "User not found.");
//             return res.status(500).json({
//                 success: false,
//                 message: "Error fetching department.",
//             });
//         }
    
//         const departmentId = userDepartment.departmentId;
    
//         // Fetch all employees in the same department
//         const { data: departmentEmployees, error: employeesFetchError } = await supabase
//             .from('staffaccounts')
//             .select('*')
//             .eq('departmentId', departmentId);
    
//         if (employeesFetchError) {
//             console.error("Error fetching employees:", employeesFetchError.message);
//             return res.status(500).json({
//                 success: false,
//                 message: "Error fetching employees from the same department.",
//             });
//         }
    
//         // Fetch feedback for all employees in the department for all quarters
//         const departmentFeedbacks = await Promise.all(
//             ['Q1', 'Q2', 'Q3', 'Q4'].map(async (quarter) => {
//                 const table = `feedbacks_${quarter}`;
//                 return supabase.from(table).select('*').eq('departmentId', departmentId);
//             })
//         );
    
//         // Flatten the results for the department's feedback from all quarters
//         const allDepartmentFeedbacks = departmentFeedbacks.reduce((acc, result) => {
//             if (result.data) acc.push(...result.data);
//             return acc;
//         }, []);
    
//         // Structure the feedback data by matching objectives and skills
//         const feedbackList = allDepartmentFeedbacks.map(feedback => ({
//             ...feedback,
//             objectives: objectives.filter(obj => obj[feedbackKey] === feedback[feedbackKey]),
//             skills: skills.filter(skill => skill[feedbackKey] === feedback[feedbackKey]),
//         }));
    
//         console.log("Feedback data fetched successfully.");
        
//         // Render the 'employeefeedbackquestionnaire' template and pass the data
//         // Pass the variables from the backend to the EJS view
//         return res.render('staffpages/employee_pages/employeefeedbackquestionnaire', {
//             feedbackList,                // List of feedback objects for the department
//             departmentEmployees,         // All employees in the department
//             user: {                      // Pass the user data (current logged-in user)
//                 userId: userId,          
//                 firstName: req.user.firstName, // Assuming the logged-in user is in req.user
//                 lastName: req.user.lastName,
//                 jobTitle: req.user.jobTitle,
//                 departmentName: req.user.departmentName,
//                 departmentId: userDepartment.departmentId,  // Add departmentId here
//             },
//         });
        
    
//     } catch (error) {
//         console.error("Error in get360FeedbackList:", error);
//         return res.status(500).json({
//             success: false,
//             message: "An error occurred while fetching feedback data.",
//             error: error.message,
//         });
//     }
    
// },


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

