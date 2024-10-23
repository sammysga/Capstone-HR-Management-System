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
            .select('firstName, lastName')
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
            lastName: staff.lastName
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

getPersInfoCareerProg: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'User not logged in.' });
            return res.redirect('/staff/login');
        }

        // Fetch user email and role from useraccounts table
        const { data: user, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId);

        // Fetch staff information including phone number, date of birth, emergency contact, and jobId
        const { data: staff, error: staffError } = await supabase
            .from('staffaccounts')
            .select('firstName, lastName, phoneNumber, dateOfBirth, emergencyContactName, emergencyContactNumber, employmentType, hireDate, departmentId, jobId, staffId') // Include staffId in the select
            .eq('userId', userId);

        // Check for staff errors
        if (staffError) {
            console.error('Error fetching staff data:', staffError);
            req.flash('errors', { dbError: 'Error fetching staff information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        const staffId = staff[0]?.staffId; // Now this should not be undefined
        console.log('Fetching degrees for staffId:', staffId);

        // Fetch degree information from staffdegrees table using staffId
        const { data: degrees, error: degreeError } = await supabase
            .from('staffdegrees')
            .select('degreeName, universityName, graduationYear')
            .eq('staffId', staffId);

        // Check for errors in fetching degrees
        if (degreeError) {
            console.error('Error fetching degree data:', degreeError);
            req.flash('errors', { dbError: 'Error fetching degree information.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        // Fetch job title from jobpositions table based on jobId
        const jobId = staff[0]?.jobId;
        if (!jobId) {
            console.error('Job ID is undefined for staff:', staff);
            req.flash('errors', { dbError: 'Job ID not found for the staff member.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

        const { data: job, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', jobId);

        // Fetch department name from departments table based on departmentId
        const { data: department, error: departmentError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', staff[0]?.departmentId);

        // Fetch career progression milestones from staffcareerprogression table based on staffId
        const { data: milestones, error: milestonesError } = await supabase
            .from('staffcareerprogression')
            .select('milestoneName, startDate, endDate')
            .eq('staffId', staffId);

        // Fetch experiences from staffexperiences table using staffId
        const { data: experiences, error: experienceError } = await supabase
            .from('staffexperiences')
            .select('companyName, startDate')
            .eq('staffId', staffId);

        // Fetch certifications from staffcertification table using staffId
        const { data: certifications, error: certificationError } = await supabase
            .from('staffcertification')
            .select('certificateName, certDate')
            .eq('staffId', staffId);

        // Check for errors
        if (userError || jobError || departmentError || milestonesError || experienceError || certificationError) {
            console.error('Error fetching user, job, department, milestones, experiences, or certifications:', userError || jobError || departmentError || milestonesError || experienceError || certificationError);
            req.flash('errors', { dbError: 'Error fetching data.' });
            return res.redirect('/employee/employeepersinfocareerprog');
        }

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
            degrees: degrees || [], // Add degrees to userData
            experiences: experiences || [], // Add experiences to userData
            certifications: certifications || [] // Add certifications to userData
        };

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
            jobTitle,
            department,
            hireDate,
            milestones, // Assuming this is an array of milestone objects
            degrees,    // Assuming this is an array of degree objects
            experiences, // Assuming this is an array of experience objects
            certifications // Assuming this is an array of certification objects
        } = req.body;

        // Update user account information
        const { error: userError } = await supabase
            .from('useraccounts')
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

        if (staffError) {
            console.error('Error updating staff account:', staffError);
            req.flash('errors', { dbError: 'Error updating staff information.' });
            return res.redirect('/employee/persinfocareerprog');
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
                .from('experiences')
                .upsert({ jobTitle, companyName, startDate, staffId: userId });
        }

        // Update certifications
        for (const certification of certifications) {
            const { certificateName, certDate } = certification;
            await supabase
                .from('certifications')
                .upsert({ certificateName, certDate, staffId: userId });
        }

        // Redirect back to the personal information page with success message
        req.flash('success', { updateSuccess: 'User information updated successfully!' });
        res.redirect('/employee/persinfocareerprog');

    } catch (err) {
        console.error('Error in updateUserInfo controller:', err);
        req.flash('errors', { dbError: 'An error occurred while updating the information.' });
        res.redirect('/employee/persinfocareerprog');
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

 // Leave Request functionality
 getLeaveRequestForm: async function(req, res) {
    console.log('Session User:', req.session.user);
    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            // Fetch leave types dynamically from Supabase
            const { data: leaveTypes, error } = await supabase
                .from('leave_types')
                .select('leaveTypeId, typeName'); // Adjust column name if necessary

            // Log the error if any
            if (error) {
                console.error('Error fetching leave types:', error.message); // Log the error message
                throw error; // Throw error to catch block
            }

            console.log('Fetched Leave Types:', leaveTypes);
            if (!leaveTypes || leaveTypes.length === 0) {
                req.flash('error', { fetchError: 'No leave types available.' });
                return res.redirect('/staff/login');
            }

            // Render the leave request form with the fetched leave types
            res.render('staffpages/employee_pages/employeeleaverequest', { leaveTypes });
        } catch (error) {
            console.error('Error rendering leave request form:', error);
            req.flash('error', { fetchError: 'Unable to load leave request form.' });
            return res.redirect('/staff/login');
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
        res.redirect('/staff/login');
    }
},
submitLeaveRequest: async function (req, res) {
    // Check if the user is authenticated
    if (!req.session.user || !req.session.user.userId) {
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    // Destructure the relevant fields from the request body
    const { leaveTypeId, fromDate, fromDayType, untilDate, untilDayType, reason } = req.body;

    // Ensure mandatory fields are provided
    if (!leaveTypeId || !fromDate || !fromDayType || !untilDate || !untilDayType || !reason) {
        return res.status(400).json({ message: 'All fields are required: Leave type, dates, day types, and reason.' });
    }

    try {
        // Log the incoming data for debugging
        console.log('Leave request data:', { userId: req.session.user.userId, leaveTypeId, fromDate, fromDayType, untilDate, untilDayType, reason });

        // Fetch staffId and departmentId associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, departmentId, firstName, lastName')  // Select staffId, departmentId, firstName, and lastName
            .eq('userId', req.session.user.userId)
            .single();

        if (fetchError || !userData) {
            return res.status(404).json({ message: 'User  not found' });
        }

        const { staffId, departmentId, firstName, lastName } = userData;

        // Log or display the user's full name for confirmation
        console.log(`Leave request submitted by: ${firstName} ${lastName}`);

        // Insert the leave request into the leave_requests table
        const { error } = await supabase
            .from('leaverequests')
            .insert([
                {
                    staffId,        // Use staffId here instead of userId
                    leaveTypeId,    // Use leaveTypeId here to reference the leave type
                    fromDate,       // Start date of leave
                    fromDayType,    // Type of the starting day (e.g., half/whole day)
                    untilDate,      // End date of leave
                    untilDayType,   // Type of the end day (e.g., half/whole day)
                    reason,         // Reason for the leave request
                    status: 'Pending for Approval', // Initial status
                    departmentId    // Add departmentId to the request
                }
            ]);

        if (error) throw error;

        // If successful, respond with a success message
        res.status(200).json({ message: `Leave request submitted successfully by ${firstName} ${lastName}` });
    } catch (error) {
        // Log and respond with error in case of failure
        console.error('Error submitting leave request:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},
getAttendance: async function (req, res) {
    // Check if the user is authenticated
    if (!req.session.user || !req.session.user.userId) {
        console.log('Unauthorized access, session:', req.session);
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    try {
        // Fetch staffId, departmentId, firstName, and lastName associated with the userId
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

        // Fetch attendance records for the current date or all records
        const { data: attendanceRecords, error: attendanceError } = await supabase
            .from('attendance')
            .select('attendanceDate, attendanceTime, attendanceAction')
            .eq('staffId', staffId) // Filter by staffId
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
    const { attendanceAction } = req.body; // Expecting attendanceAction (Time In or Time Out)

    // Ensure mandatory fields are provided
    if (!attendanceAction) {
        return res.status(400).json({ message: 'Attendance action is required (Time In or Time Out).' });
    }

    try {
        // Fetch staffId and user details associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, firstName, lastName')
            .eq('userId', req.session.user.userId)
            .single();

        if (fetchError || !userData) {
            return res.status(404).json({ message: 'User  not found' });
        }

        const { staffId, firstName, lastName } = userData;

        // Get the current date and time
        const currentDate = new Date();
        const attendanceDate = currentDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
        const attendanceTime = currentDate.toTimeString().split(' ')[0]; // Format: HH:MM:SS

        // Insert the attendance record into the attendance table
        const { error: insertError } = await supabase
            .from('attendance')
            .insert([
                {
                    staffId,              // Foreign key reference to staff
                    attendanceDate,       // Current date
                    attendanceTime,       // Current time
                    attendanceAction      // Action: Time In or Time Out
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

};

module.exports = employeeController;
