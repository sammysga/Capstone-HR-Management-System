const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');


function checkActivitiesCompletion(activities) {
    if (!activities || activities.length === 0) {
        return { 
            completed: false, 
            reason: 'No activities found',
            total: 0,
            incomplete: 0
        };
    }
    
    // Handle various status formats
    const completedVariations = [
        'Completed', 'completed', 'COMPLETED',
        'Complete', 'complete', 'COMPLETE',
        'Done', 'done', 'DONE',
        'Finished', 'finished', 'FINISHED'
    ];
    
    const incompleteActivities = activities.filter(activity => {
        if (!activity.status) return true; // No status = incomplete
        
        const trimmedStatus = activity.status.toString().trim();
        return !completedVariations.includes(trimmedStatus);
    });
    
    return {
        completed: incompleteActivities.length === 0,
        total: activities.length,
        incomplete: incompleteActivities.length,
        incompleteList: incompleteActivities.map(act => ({
            id: act.activityId,
            name: act.activityName || 'Unknown Activity',
            status: act.status
        }))
    };
}


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
        
        // Fetch user account details
        const { data: user, error } = await supabase
            .from('useraccounts')
            .select('userEmail, userRole')
            .eq('userId', userId)
            .single();
            
        // Fetch staff details with department and job title
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
            
        // Fetch any active offboarding requests for this user
        const { data: offboardingRequests, error: offboardingError } = await supabase
            .from('offboarding_requests')
            .select('*')
            .eq('userId', userId)
            .order('created_at', { ascending: false });
            
        if (error || staffError) {
            console.error('Error fetching user or staff details:', error || staffError);
            req.flash('errors', { dbError: 'Error fetching user data.' });
            return res.redirect('/staff/employee/dashboard');
        }
        
        if (offboardingError) {
            console.error('Error fetching offboarding requests:', offboardingError);
            // Continue without offboarding data rather than failing the page load
        }
        
        // Combine user data
        const userData = {
            ...user,
            firstName: staff.firstName,
            lastName: staff.lastName,
            deptName: staff.departments.deptName,
            jobTitle: staff.jobpositions.jobTitle
        };
        
        res.render('staffpages/employee_pages/useracc', { 
            user: userData,
            offboardingRequests: offboardingRequests || [] 
        });
    } catch (err) {
        console.error('Error in getUserAccount controller:', err);
        req.flash('errors', { dbError: 'An error occurred while loading the account page.' });
        res.redirect('/staff/employee/dashboard');
    }
},

getEmployeeNotifications: async function(req, res) {
        // Check for authentication
        if (!req.session.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    
        try {
            const userId = req.session.user.userId;
            
            // Fetch user's applicant status
            const { data: userData, error: userError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, applicantStatus, lastName, firstName')
                .eq('userId', userId)
                .single();
                
            const applicantStatus = userData ? userData.applicantStatus : null;
            const userFullName = userData ? `${userData.firstName} ${userData.lastName}` : null;
            
            // 1. Fetch 360 degree feedback submissions that need action
            const { data: feedbackData, error: feedbackError } = await supabase
                .from('feedback_periods')
                .select('feedbackId, quarter, startDate, endDate, isActive')
                .eq('isActive', true)
                .order('endDate', { ascending: true });
    
            if (feedbackError) throw feedbackError;
    
            // Filter to get only the ones relevant to this employee
            const currentDate = new Date();
            const activeFeedbacks = feedbackData.filter(feedback => 
                new Date(feedback.endDate) > currentDate && 
                new Date(feedback.startDate) <= currentDate
            );
    
            // Format the feedback data 
            const formattedFeedbackSubmissions = activeFeedbacks.map(feedback => {
                const daysRemaining = Math.ceil((new Date(feedback.endDate) - currentDate) / (1000 * 60 * 60 * 24));
                
                return {
                    id: feedback.feedbackId,
                    quarter: feedback.quarter,
                    startDate: feedback.startDate,
                    endDate: feedback.endDate,
                    isUrgent: daysRemaining <= 3, // Mark as urgent if 3 or fewer days remaining
                    daysRemaining: daysRemaining,
                    formattedDate: new Date(feedback.startDate).toLocaleString('en-US', {
                        weekday: 'short', 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit'
                    })
                };
            });
    
            // 2. Fetch pending leave requests
            const { data: leaveRequests, error: leaveRequestsError } = await supabase
                .from('leaverequests')
                .select('leaveRequestId, leaveTypeId, fromDate, untilDate, status, updated_at, leave_types(typeName)')
                .eq('userId', userId)
                .in('status', ['Pending for Approval', 'Approved', 'Rejected'])
                .order('updated_at', { ascending: false })
                .limit(5);
    
            if (leaveRequestsError) throw leaveRequestsError;
    
            // Format the leave requests data
            const formattedLeaveRequests = leaveRequests.map(request => ({
                id: request.leaveRequestId,
                type: request.leave_types?.typeName || 'Leave',
                from: new Date(request.fromDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                until: new Date(request.untilDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                status: request.status,
                updateDate: new Date(request.updated_at).toLocaleString('en-US', {
                    weekday: 'short', 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric', 
                    hour: '2-digit', 
                    minute: '2-digit'
                })
            }));
    
            // 3. Fetch performance updates
            const { data: performanceData, error: performanceError } = await supabase
                .from('staff_performance_updates')
                .select('updateId, updateType, updateTitle, updateDescription, created_at')
                .eq('userId', userId)
                .order('created_at', { ascending: false })
                .limit(5);
    
            if (performanceError) throw performanceError;
    
            // Format performance updates
            const formattedPerformanceUpdates = performanceData.map(update => ({
                id: update.updateId,
                type: update.updateType,
                title: update.updateTitle,
                description: update.updateDescription,
                date: new Date(update.created_at).toLocaleString('en-US', {
                    weekday: 'short', 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric'
                })
            }));
    
            // Improved API request detection - checking multiple conditions
            const isApiRequest = req.xhr || 
                                req.headers.accept?.includes('application/json') || 
                                req.path.includes('/api/');
    
            // If it's an API request, return JSON with explicit content type
            if (isApiRequest) {
                return res
                    .header('Content-Type', 'application/json')
                    .json({
                        feedbackSubmissions: formattedFeedbackSubmissions,
                        leaveRequests: formattedLeaveRequests,
                        performanceUpdates: formattedPerformanceUpdates,
                        notificationCount: formattedFeedbackSubmissions.length + formattedLeaveRequests.length + formattedPerformanceUpdates.length,
                        // Include user information
                        userInfo: {
                            applicantStatus: applicantStatus,
                            fullName: userFullName
                        }
                    });
            }
    
            // Otherwise, return the rendered partial template
            return res.render('partials/employee_partials', {
                feedbackSubmissions: formattedFeedbackSubmissions,
                leaveRequests: formattedLeaveRequests,
                performanceUpdates: formattedPerformanceUpdates,
                notificationCount: formattedFeedbackSubmissions.length + formattedLeaveRequests.length + formattedPerformanceUpdates.length,
                // Include user information
                userInfo: {
                    applicantStatus: applicantStatus,
                    fullName: userFullName
                }
            });
        } catch (err) {
            console.error('Error fetching notification data:', err);
            
            // Better error handling for API requests
            const isApiRequest = req.xhr || 
                               req.headers.accept?.includes('application/json') || 
                               req.path.includes('/api/');
            
            if (isApiRequest) {
                return res
                    .status(500)
                    .header('Content-Type', 'application/json')
                    .json({ 
                        error: 'An error occurred while loading notifications.',
                        details: process.env.NODE_ENV === 'development' ? err.message : undefined
                    });
            }
            
            return res.status(500).send('Error loading notifications');
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
        const { firstName, lastName } = req.body;

        // Update the user info in 'staffaccounts' tables; deleted the updating of email 
        const { error: staffError } = await supabase
            .from('staffaccounts')
            .update({ firstName, lastName })
            .eq('userId', userId);

        if (staffError) {
            console.error('Error updating user information:', staffError);
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
},

editPersonalInformation: async function(req, res) {
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

        // First, get the staffId associated with this userId
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('staffId')
            .eq('userId', userId)
            .single();

        if (staffError || !staffData) {
            console.error('Error fetching staff ID:', staffError);
            req.flash('errors', { dbError: 'Error fetching staff information.' });
            return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
        }

        const staffId = staffData.staffId;
        const { milestones = [] } = req.body;

        console.log("Saving career progression for staffId:", staffId, "Milestones:", milestones);

        // Delete old career milestones before inserting new ones
        const { error: deleteError } = await supabase
            .from('staffcareerprogression')
            .delete()
            .eq('staffId', staffId);
            
        if (deleteError) {
            console.error('Error deleting existing milestones:', deleteError);
        }

        // Insert new milestones
        for (const milestone of milestones) {
            const { milestoneName, startDate, endDate } = milestone;
            const { error: insertError } = await supabase
                .from('staffcareerprogression')
                .insert({
                    milestoneName,
                    startDate,
                    endDate: endDate || null,
                    staffId: staffId
                });
                
            if (insertError) {
                console.error('Error inserting milestone:', insertError);
                throw insertError;
            }
        }

        return res.json({ 
            success: true, 
            message: 'Career progression updated successfully!' 
        });
    } catch (err) {
        console.error('Error in editCareerProgression:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while updating career progression.' 
        });
    }
},

editDegreeInformation: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // First, get the staffId associated with this userId
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('staffId')
            .eq('userId', userId)
            .single();

        if (staffError || !staffData) {
            console.error('Error fetching staff ID:', staffError);
            req.flash('errors', { dbError: 'Error fetching staff information.' });
            return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
        }

        const staffId = staffData.staffId;
        const { degrees = [] } = req.body;

        console.log("Saving degree information for staffId:", staffId, "Degrees:", degrees);

        // Delete old degrees before inserting new ones
        const { error: deleteError } = await supabase
            .from('staffdegrees')
            .delete()
            .eq('staffId', staffId);
            
        if (deleteError) {
            console.error('Error deleting existing degrees:', deleteError);
        }

        // Insert new degrees
        for (const degree of degrees) {
            const { degreeName, universityName, graduationYear } = degree;
            const { error: insertError } = await supabase
                .from('staffdegrees')
                .insert({
                    degreeName,
                    universityName,
                    graduationYear,
                    staffId: staffId
                });
                
            if (insertError) {
                console.error('Error inserting degree:', insertError);
                throw insertError;
            }
        }

        return res.json({ 
            success: true, 
            message: 'Degree information updated successfully!' 
        });
    } catch (err) {
        console.error('Error in editDegreeInformation:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while updating degree information.' 
        });
    }
},

editExperiences: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // First, get the staffId associated with this userId
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('staffId')
            .eq('userId', userId)
            .single();

        if (staffError || !staffData) {
            console.error('Error fetching staff ID:', staffError);
            req.flash('errors', { dbError: 'Error fetching staff information.' });
            return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
        }

        const staffId = staffData.staffId;
        const { experiences = [] } = req.body;

        console.log("Saving experiences for staffId:", staffId, "Experiences:", experiences);

        // Delete old experiences before inserting new ones
        const { error: deleteError } = await supabase
            .from('staffexperiences')
            .delete()
            .eq('staffId', staffId);
            
        if (deleteError) {
            console.error('Error deleting existing experiences:', deleteError);
        }

        // Insert new experiences
        for (const experience of experiences) {
            const { companyName, jobTitle, startDate, endDate } = experience;
            const { error: insertError } = await supabase
                .from('staffexperiences')
                .insert({
                    companyName,
                    jobTitle: jobTitle || '',
                    startDate,
                    endDate: endDate || null,
                    staffId: staffId
                });
                
            if (insertError) {
                console.error('Error inserting experience:', insertError);
                throw insertError;
            }
        }

        return res.json({ 
            success: true, 
            message: 'Experience information updated successfully!' 
        });
    } catch (err) {
        console.error('Error in editExperiences:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while updating experience information.' 
        });
    }
},

editCertifications: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        if (!userId) {
            req.flash('errors', { authError: 'Unauthorized access.' });
            return res.redirect('/staff/login');
        }

        // First, get the staffId associated with this userId
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('staffId')
            .eq('userId', userId)
            .single();

        if (staffError || !staffData) {
            console.error('Error fetching staff ID:', staffError);
            req.flash('errors', { dbError: 'Error fetching staff information.' });
            return res.status(500).json({ success: false, error: 'Error fetching staff information.' });
        }

        const staffId = staffData.staffId;
        const { certifications = [] } = req.body;

        console.log("Saving certifications for staffId:", staffId, "Certifications:", certifications);

        // Delete old certifications before inserting new ones
        const { error: deleteError } = await supabase
            .from('staffcertification')  // Note: The table name is 'staffcertification' (singular), not 'staffcertifications'
            .delete()
            .eq('staffId', staffId);
            
        if (deleteError) {
            console.error('Error deleting existing certifications:', deleteError);
        }

        // Insert new certifications
        for (const certification of certifications) {
            const { certificateName, certDate } = certification;
            const { error: insertError } = await supabase
                .from('staffcertification')  // Note: The table name is 'staffcertification' (singular)
                .insert({
                    certificateName,
                    certDate,
                    staffId: staffId
                });
                
            if (insertError) {
                console.error('Error inserting certification:', insertError);
                throw insertError;
            }
        }

        return res.json({ 
            success: true, 
            message: 'Certification information updated successfully!' 
        });
    } catch (err) {
        console.error('Error in editCertifications:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while updating certification information.' 
        });
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

        const { message, lastDay, reason, offboardingType, yearsOfService, noticePeriod } = req.body;

        // Validate required fields based on the offboarding type
        if (!message || !lastDay || !offboardingType) {
            req.flash('errors', { formError: 'Please fill in all required fields.' });
            return res.redirect('/employee/employeeoffboarding');
        }

        if (offboardingType === 'Resignation' && !reason) {
            req.flash('errors', { formError: 'Please provide a reason for resignation.' });
            return res.redirect('/employee/employeeoffboarding');
        }

        if (offboardingType === 'Retirement' && (yearsOfService === undefined || yearsOfService.trim() === "")) {
            req.flash('errors', { formError: 'Please provide years of service and early retirement status.' });
            return res.redirect('/employee/employeeoffboarding');
        }

        // // Convert earlyRetirement to a boolean if needed
        // const earlyRetirementBoolean = earlyRetirement === 'Yes';

        const offboardingData = {
            userId,
            message,
            last_day: lastDay,
            notice_period_start: noticePeriod,
            status: 'Pending Line Manager', // Default status
            reason: offboardingType === 'Resignation' ? reason : null,
            offboardingType,
            yearsOfService: offboardingType === 'Retirement' ? yearsOfService : null,
            // earlyRetirement: offboardingType === 'Retirement' ? earlyRetirementBoolean : null
        };

        // Insert into the database
        const { data: offboarding, error: insertError } = await supabase
            .from('offboarding_requests')
            .insert([offboardingData])
            .select('*')
            .single();

        console.log('Insert Result:', offboarding);

        if (insertError) {
            console.error('Error inserting offboarding request:', insertError);
            req.flash('errors', { dbError: 'Failed to save offboarding details.' });
            return res.redirect('/employee/employeeoffboarding');
        }

        req.flash('success', 'Your offboarding request has been submitted successfully.');
        res.redirect('/employee/useracc');
    } catch (err) {
        console.error('Error in postEmployeeOffboarding controller:', err);
        req.flash('errors', { dbError: 'An error occurred while processing the request.' });
        res.redirect('/employee/employeeoffboarding');
    }
},

// Get clearance items for a specific request
getClearanceItems: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        const requestId = req.params.requestId;
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized access.' 
            });
        }
        
        console.log(`Getting clearance items for request ID: ${requestId}, user ID: ${userId}`);
        
        // Verify request exists and belongs to the user
        const { data: request, error: requestError } = await supabase
            .from('offboarding_requests')
            .select('*')
            .eq('requestId', requestId)
            .eq('userId', userId)
            .single();
            
        if (requestError) {
            console.error('Error fetching offboarding request:', requestError);
            return res.status(404).json({ 
                success: false, 
                error: 'Request not found or unauthorized access.' 
            });
        }
        
        if (!request) {
            console.error('Request not found for ID:', requestId);
            return res.status(404).json({ 
                success: false, 
                error: 'Request not found or unauthorized access.' 
            });
        }
        
        // Check if the request status is "Sent to Employee"
        if (request.status !== 'Sent to Employee') {
            console.log(`Request status is ${request.status}, not "Sent to Employee"`);
            return res.status(400).json({ 
                success: false, 
                error: 'This clearance form is not available for completion yet.' 
            });
        }
        
        // Fetch clearance checklist
        const { data: checklistData, error: checklistError } = await supabase
            .from('offboarding_checklist')
            .select('checklist_items')
            .eq('requestId', requestId)
            .single();
            
        if (checklistError && checklistError.code !== 'PGRST116') { // Ignore "No rows found" error
            console.error('Error fetching checklist:', checklistError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to load clearance checklist.' 
            });
        }
        
        console.log('Checklist data found:', checklistData ? 'Yes' : 'No');
        
        return res.json({ 
            success: true, 
            checklist: checklistData ? checklistData.checklist_items : [],
            lastDay: request.last_day
        });
    } catch (err) {
        console.error('Error in getClearanceItems controller:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while loading clearance items.' 
        });
    }
},

// Cancel offboarding request
cancelOffboardingRequest: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        const { requestId } = req.body;
        
        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized access.' 
            });
        }
        
        console.log(`Cancelling request ID: ${requestId} for user ID: ${userId}`);
        
        // Verify request exists and belongs to the user
        const { data: request, error: requestError } = await supabase
            .from('offboarding_requests')
            .select('status')
            .eq('requestId', requestId)
            .eq('userId', userId)
            .single();
            
        if (requestError || !request) {
            console.error('Error fetching offboarding request:', requestError);
            return res.status(404).json({ 
                success: false, 
                error: 'Request not found or unauthorized access.' 
            });
        }
        
        // Check if the request can be cancelled (only in Pending status)
        if (request.status !== 'Pending Line Manager' && request.status !== 'Pending HR') {
            return res.status(400).json({ 
                success: false, 
                error: 'This request cannot be cancelled in its current status.' 
            });
        }
        
        // Delete the request
        const { error: deleteError } = await supabase
            .from('offboarding_requests')
            .delete()
            .eq('requestId', requestId)
            .eq('userId', userId);
            
        if (deleteError) {
            console.error('Error deleting offboarding request:', deleteError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to cancel offboarding request.' 
            });
        }
        
        console.log('Request cancelled successfully');
        
        return res.json({ 
            success: true, 
            message: 'Offboarding request cancelled successfully.' 
        });
    } catch (err) {
        console.error('Error in cancelOffboardingRequest controller:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while processing the request.' 
        });
    }
},

// Submit completed clearance
// Modify your submitEmployeeClearance function to check if the column exists

submitEmployeeClearance: async function(req, res) {
    try {
        const userId = req.session.user ? req.session.user.userId : null;
        const { requestId, signatures, completed } = req.body;
        
        console.log("Clearance submission received:", {
            userId,
            requestId,
            signaturesCount: signatures ? Object.keys(signatures).length : 0,
            completed
        });
        
        if (!userId) {
            console.error("No user ID in session");
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized access.' 
            });
        }
        
        if (!requestId) {
            console.error("No requestId provided in request body");
            return res.status(400).json({
                success: false,
                error: 'Request ID is required.'
            });
        }
        
        console.log(`Submitting clearance for request ID: ${requestId}, user ID: ${userId}`);
        
        // Verify request exists and belongs to the user
        const { data: request, error: requestError } = await supabase
            .from('offboarding_requests')
            .select('*')
            .eq('requestId', requestId)
            .eq('userId', userId)
            .single();
            
        if (requestError) {
            console.error('Error fetching offboarding request:', requestError);
            return res.status(404).json({ 
                success: false, 
                error: 'Request not found or unauthorized access.' 
            });
        }
        
        if (!request) {
            console.error('Request not found for ID:', requestId);
            return res.status(404).json({ 
                success: false, 
                error: 'Request not found or unauthorized access.' 
            });
        }
        
        console.log('Found request with status:', request.status);
        
        // First, check if the employee_signatures column exists
        try {
            // Try to query for employee_signatures to see if it exists
            console.log('Checking if employee_signatures column exists');
            const { data: columnCheck, error: columnError } = await supabase
                .from('offboarding_requests')
                .select('employee_signatures')
                .limit(1);
                
            if (columnError) {
                console.error('Error checking column:', columnError);
                // Column might not exist, update without it
                console.log('Updating request without employee_signatures');
                
                const { data: updateData, error: updateError } = await supabase
                    .from('offboarding_requests')
                    .update({ 
                        status: 'Completed by Employee',
                        employee_completion_date: new Date().toISOString()
                        // employee_signatures column omitted
                    })
                    .eq('requestId', requestId)
                    .select();
                    
                if (updateError) {
                    console.error('Error updating request status:', updateError);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Failed to update request status: ' + updateError.message
                    });
                }
                
                console.log('Request status updated successfully:', updateData);
            } else {
                // Column exists, update with employee_signatures
                console.log('Updating request with employee_signatures');
                
                const { data: updateData, error: updateError } = await supabase
                    .from('offboarding_requests')
                    .update({ 
                        status: 'Completed by Employee',
                        employee_completion_date: new Date().toISOString(),
                        employee_signatures: JSON.stringify(signatures)
                    })
                    .eq('requestId', requestId)
                    .select();
                    
                if (updateError) {
                    console.error('Error updating request status:', updateError);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Failed to update request status: ' + updateError.message
                    });
                }
                
                console.log('Request updated successfully with signatures:', updateData);
            }
        } catch (err) {
            console.error('Exception updating request:', err);
            return res.status(500).json({
                success: false,
                error: 'Exception occurred while updating request: ' + err.message
            });
        }
        
        console.log('Clearance submission completed successfully');
        
        return res.json({ 
            success: true, 
            message: 'Clearance submitted successfully.' 
        });
    } catch (err) {
        console.error('Error in submitEmployeeClearance controller:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'An error occurred while processing the request: ' + err.message 
        });
    }
},

getLeaveRequestForm: async function(req, res) {
    console.log('Session User:', req.session.user);
    
    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            const userId = req.session.user.userId;

            // Fetch active leave types
            const { data: leaveTypes, error: leaveTypesError } = await supabase
                .from('leave_types')
                .select('leaveTypeId, typeName, typeIsActive, typeMaxCount')
                .eq('typeIsActive', true);

            if (leaveTypesError) throw leaveTypesError;

            console.log('Fetched leave types:', leaveTypes);

            // Fetch leave requests for the logged-in employee
            const { data: leaveRequests, error: leaveRequestsError } = await supabase
                .from('leaverequests')
                .select(`
                    leaveRequestId,
                    leaveTypeId,
                    fromDate,
                    untilDate,
                    fromDayType,
                    untilDayType,
                    status,
                    leave_types(typeName)
                `)
                .eq('userId', userId)
                .order('fromDate', { ascending: false });

            if (leaveRequestsError) throw leaveRequestsError;

            console.log('Fetched leave requests:', leaveRequests);

            // Calculate effective leave balances
            const leaveBalancesPromises = leaveTypes.map(async (leaveType) => {
                console.log(`\n=== Processing ${leaveType.typeName} (ID: ${leaveType.leaveTypeId}) ===`);
                
                if (!leaveType.leaveTypeId) {
                    console.warn(`Leave Type ID is missing for ${leaveType.typeName}. Defaulting to max count.`);
                    return {
                        typeName: leaveType.typeName,
                        totalLeaves: leaveType.typeMaxCount,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount
                    };
                }

                // Get the LATEST balance from leavebalances table
                const { data: balanceData, error: balanceError } = await supabase
                    .from('leavebalances')
                    .select('totalLeaves, usedLeaves, remainingLeaves, created_at')
                    .eq('userId', userId)
                    .eq('leaveTypeId', leaveType.leaveTypeId)
                    .order('created_at', { ascending: false })
                    .limit(1);

                let currentBalance;
                if (balanceError || !balanceData || balanceData.length === 0) {
                    console.warn(`No balance found for ${leaveType.typeName}. Defaulting to max count.`);
                    currentBalance = {
                        totalLeaves: leaveType.typeMaxCount,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount
                    };
                } else {
                    currentBalance = balanceData[0];
                    console.log(`Found balance record:`, currentBalance);
                }

                // Find pending requests for this specific leave type
                const pendingRequests = leaveRequests.filter(request => {
                    const isMatchingType = request.leaveTypeId === leaveType.leaveTypeId;
                    const isPending = request.status === 'Pending for Approval';
                    console.log(`Request ${request.leaveRequestId}: Type match=${isMatchingType}, Status=${request.status}, Is pending=${isPending}`);
                    return isMatchingType && isPending;
                });

                console.log(`Found ${pendingRequests.length} pending requests for ${leaveType.typeName}:`, pendingRequests);

                let totalPendingDays = 0;
                pendingRequests.forEach(request => {
                    const fromDate = new Date(request.fromDate);
                    const untilDate = new Date(request.untilDate);
                    
                    // Calculate base days (inclusive)
                    let days = Math.ceil((untilDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
                    
                    // Adjust for half days
                    if (request.fromDayType === 'half_day') {
                        days -= 0.5;
                        console.log(`Adjusted for half day start: -0.5`);
                    }
                    if (request.untilDayType === 'half_day') {
                        days -= 0.5;
                        console.log(`Adjusted for half day end: -0.5`);
                    }
                    
                    console.log(`Request ${request.leaveRequestId}: ${request.fromDate} to ${request.untilDate} = ${days} days`);
                    totalPendingDays += days;
                });

                console.log(`Total pending days for ${leaveType.typeName}: ${totalPendingDays}`);

                // Calculate effective remaining leaves
                const effectiveRemainingLeaves = Math.max(0, currentBalance.remainingLeaves - totalPendingDays);

                console.log(`${leaveType.typeName} calculation:`);
                console.log(`  Database remaining: ${currentBalance.remainingLeaves}`);
                console.log(`  Pending days: ${totalPendingDays}`);
                console.log(`  Effective remaining: ${effectiveRemainingLeaves}`);

                return {
                    typeName: leaveType.typeName,
                    totalLeaves: currentBalance.totalLeaves,
                    usedLeaves: currentBalance.usedLeaves,
                    remainingLeaves: effectiveRemainingLeaves
                };
            });

            const leaveBalances = await Promise.all(leaveBalancesPromises);
            console.log('\n=== Final leave balances ===');
            leaveBalances.forEach(balance => {
                console.log(`${balance.typeName}: ${balance.remainingLeaves} remaining`);
            });

            res.render('staffpages/employee_pages/employeeleaverequest', { 
                leaveTypes, 
                leaveRequests, 
                leaveBalances 
            });
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
    if (!req.session.user || !req.session.user.userId) {
        console.log('Unauthorized access: No session user');
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    try {
        // Handle file upload if a medical certificate is included
        let certificationPath = null;
        
        if (req.files && req.files.certification) {
            console.log('📂 [Leave Request] Medical certificate file detected, processing upload...');
            
            const file = req.files.certification;
            console.log(`📎 [Leave Request] File received: ${file.name} (Type: ${file.mimetype}, Size: ${file.size} bytes)`);
            
            // File validation
            const allowedTypes = [
                'application/pdf', 'image/jpeg', 'image/png'
            ];
            const maxSize = 5 * 1024 * 1024; // 5 MB
            
            if (file.size > maxSize) {
                console.log('❌ [Leave Request] File size exceeds the 5 MB limit.');
                return res.status(400).json({ message: 'File size exceeds the 5 MB limit.' });
            }
            
            if (!allowedTypes.includes(file.mimetype)) {
                console.log('❌ [Leave Request] Invalid file type. Only PDF and image files are allowed.');
                return res.status(400).json({ message: 'Invalid file type. Only PDF and image files are allowed.' });
            }
            
            // Generate unique file name
            const uniqueName = `cert-${Date.now()}-${file.name}`;
            const filePath = path.join(__dirname, '../uploads', uniqueName);
            
            // Ensure uploads directory exists
            if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
                fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
            }
            
            // Save file locally
            await file.mv(filePath);
            console.log('📂 [Leave Request] File successfully saved locally. Uploading to Supabase...');
            
            // Upload to Supabase
            const { error: uploadError } = await supabase.storage
                .from('uploads')  // Use the existing bucket name
                .upload(uniqueName, fs.readFileSync(filePath), {
                    contentType: file.mimetype,
                    cacheControl: '3600',
                    upsert: false,
                });
            
            // Remove local file after upload
            fs.unlinkSync(filePath);
            console.log('📂 [Leave Request] Local file deleted after upload to Supabase.');
            
            if (uploadError) {
                console.error('❌ [Leave Request] Error uploading file to Supabase:', uploadError);
                return res.status(500).json({ message: 'Error uploading medical certificate.' });
            }
            
            // Get the public URL for the file
            certificationPath = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uniqueName}`;
            console.log(`✅ [Leave Request] File uploaded successfully: ${certificationPath}`);
        }
        
        // Get form fields from req.body
        const { 
            leaveTypeId, 
            fromDate, 
            untilDate, 
            reason, 
            fromDayType, 
            untilDayType,
            isSickLeave,
            isSelfCertified
        } = req.body;

        if (!leaveTypeId || !fromDate || !untilDate || !reason || !fromDayType || !untilDayType) {
            console.log('Missing fields in leave request submission', req.body);
            return res.status(400).json({ message: 'All fields are required.' });
        }

        // Get the leave type
        const { data: leaveTypeData, error: leaveTypeError } = await supabase
            .from('leave_types')
            .select('typeName, typeMaxCount')
            .eq('leaveTypeId', leaveTypeId)
            .single();

        if (leaveTypeError || !leaveTypeData) {
            console.log('Leave type not found or error:', leaveTypeError);
            return res.status(404).json({ message: 'Leave type not found' });
        }

        // Calculate days for validation
        const fromDateObj = new Date(fromDate);
        const untilDateObj = new Date(untilDate);
        let daysRequested = Math.ceil((untilDateObj - fromDateObj) / (1000 * 60 * 60 * 24)) + 1;
        
        // Adjust for half days if specified
        if (fromDayType === 'half_day') {
            daysRequested -= 0.5;
        }
        if (untilDayType === 'half_day') {
            daysRequested -= 0.5;
        }

        console.log('Days requested:', daysRequested);

        // Check leave balance to ensure sufficient days are available
        const { data: balanceData, error: balanceError } = await supabase
            .from('leavebalances')
            .select('usedLeaves, remainingLeaves, totalLeaves')
            .eq('userId', req.session.user.userId)
            .eq('leaveTypeId', leaveTypeId)
            .single();

        let totalLeaves, remainingLeaves;
        if (balanceError || !balanceData) {
            totalLeaves = leaveTypeData.typeMaxCount;
            remainingLeaves = totalLeaves;
        } else {
            totalLeaves = balanceData.totalLeaves;
            remainingLeaves = balanceData.remainingLeaves;
        }

        if (remainingLeaves < daysRequested) {
            console.log(`Insufficient leave balance. Remaining: ${remainingLeaves}, Requested: ${daysRequested}`);
            return res.status(400).json({ message: 'Insufficient leave balance for the requested period.' });
        }

        // Prepare leave request data
        const leaveRequestData = {
            userId: req.session.user.userId,
            leaveTypeId,
            fromDate,
            untilDate,
            fromDayType,
            untilDayType,
            reason,
            status: 'Pending for Approval'
        };

        // Handle certification for sick leave
        if (isSickLeave === 'true') {
            const isSickLeaveType = leaveTypeData.typeName.toLowerCase().includes('sick');
            
            if (!isSickLeaveType) {
                console.log('Mismatch between leave type and sick leave flag');
                return res.status(400).json({ message: 'Invalid leave type for sick leave certification.' });
            }
            
            // Check if self-certification is applicable (for 1-2 day sick leaves)
            if (daysRequested <= 2 && isSelfCertified === 'true') {
                console.log('Applying self-certification for short sick leave');
                leaveRequestData.isSelfCertified = true;
            } else if (daysRequested > 2) {
                // Medical certificate required for longer sick leave
                if (certificationPath) {
                    // If a file was uploaded, store the path
                    leaveRequestData.certificationPath = certificationPath;
                    console.log('Medical certificate uploaded for extended sick leave');
                } else {
                    console.log('Missing required certification for extended sick leave');
                    return res.status(400).json({ 
                        message: 'Medical certificate is required for sick leaves of 3 or more days.' 
                    });
                }
            }
        } else if (certificationPath) {
            // If a certificate was uploaded for non-sick leave, still store it
            leaveRequestData.certificationPath = certificationPath;
        }

        // Log data before insert for debugging
        console.log('Inserting leave request with data:', leaveRequestData);

        // Insert the leave request
        const { data: insertedData, error: requestError } = await supabase
            .from('leaverequests')
            .insert([leaveRequestData])
            .select();

        if (requestError) {
            console.error('Error inserting leave request:', requestError.message);
            return res.status(500).json({ message: 'Failed to submit leave request.' });
        }

        console.log('Leave request inserted successfully:', insertedData);

        // REMOVED: We no longer update leave balances here
        // This will happen when the manager approves the request

        // Return success with certification info
        res.status(200).json({ 
            message: 'Leave request submitted successfully.',
            leaveType: leaveTypeData.typeName,
            isSelfCertified: leaveRequestData.isSelfCertified || false,
            hasCertification: !!certificationPath
        });
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
                const { data: leaveBalances, error: balanceError } = await supabase
                    .from('leavebalances')
                    .select('totalLeaves, usedLeaves, remainingLeaves')
                    .eq('userId', req.session.user.userId)
                    .eq('leaveTypeId', leaveType.leaveTypeId)
                    .order('createdAt', { ascending: false }) // Get the most recent balance
                    .limit(1); // Only get the most recent entry
                
                // Handle case where no balance exists yet or error occurred
                if (balanceError || !leaveBalances || leaveBalances.length === 0) {
                    console.warn(`No leave balance found for ${leaveType.typeName}. Defaulting to max count.`);
                    return {
                        leaveTypeId: leaveType.leaveTypeId,
                        typeName: leaveType.typeName,
                        totalLeaves: leaveType.typeMaxCount,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount
                    };
                }
                
                // Return the most recent balance record
                return {
                    leaveTypeId: leaveType.leaveTypeId,
                    typeName: leaveType.typeName,
                    totalLeaves: leaveBalances[0].totalLeaves,
                    usedLeaves: leaveBalances[0].usedLeaves,
                    remainingLeaves: leaveBalances[0].remainingLeaves
                };
            });
             
            const leaveBalances = await Promise.all(leaveBalancesPromises);
            console.log('Fetched leave balances:', leaveBalances);
             
            // Step 3: Fetch leave requests for the logged-in employee with type information
            const { data: leaveRequests, error: leaveRequestsError } = await supabase
                .from('leaverequests')
                .select(`
                    *,
                    leave_types (
                        typeName
                    )
                `) // Join with leave_types to get type names
                .eq('userId', req.session.user.userId)
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
getLatestLeaveBalances: async function(req, res) {
    console.log('Fetching latest leave balances for user...');
    
    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            const userId = req.session.user.userId;
            console.log(`User ID: ${userId}`);

            // Step 1: Fetch active leave types
            const { data: activeLeaveTypes, error: leaveTypesError } = await supabase
                .from('leave_types')
                .select('leaveTypeId, typeName, typeMaxCount')
                .eq('typeIsActive', true);
            
            if (leaveTypesError) {
                console.error('Error fetching leave types:', leaveTypesError.message);
                throw leaveTypesError;
            }

            console.log('Active leave types:', activeLeaveTypes);

            // Step 2: Fetch all leave requests to calculate pending days
            const { data: allLeaveRequests, error: requestsError } = await supabase
                .from('leaverequests')
                .select('leaveRequestId, leaveTypeId, fromDate, untilDate, fromDayType, untilDayType, status')
                .eq('userId', userId);

            if (requestsError) {
                console.error('Error fetching leave requests:', requestsError.message);
                throw requestsError;
            }

            console.log('All leave requests for user:', allLeaveRequests);
            
            // Step 3: For each leave type, calculate effective balance
            const leaveBalancesPromises = activeLeaveTypes.map(async (leaveType) => {
                console.log(`\n=== Processing ${leaveType.typeName} (API call) ===`);
                
                // Get the most recent leave balance for this user and leave type
                const { data: latestBalances, error: balanceError } = await supabase
                    .from('leavebalances')
                    .select('totalLeaves, usedLeaves, remainingLeaves, created_at')
                    .eq('userId', userId)
                    .eq('leaveTypeId', leaveType.leaveTypeId)
                    .order('created_at', { ascending: false })
                    .limit(1);
                
                if (balanceError) {
                    console.error(`Error fetching balance for ${leaveType.typeName}:`, balanceError.message);
                    throw balanceError;
                }
                
                // Set default values if no balance found
                let currentBalance;
                if (!latestBalances || latestBalances.length === 0) {
                    console.log(`No balance record found for ${leaveType.typeName}, using defaults`);
                    currentBalance = {
                        totalLeaves: leaveType.typeMaxCount || 0,
                        usedLeaves: 0,
                        remainingLeaves: leaveType.typeMaxCount || 0
                    };
                } else {
                    currentBalance = latestBalances[0];
                    console.log(`Latest balance for ${leaveType.typeName}:`, currentBalance);
                }

                // Calculate pending leave days for this leave type
                const pendingRequests = allLeaveRequests.filter(request => {
                    const isMatchingType = request.leaveTypeId === leaveType.leaveTypeId;
                    const isPending = request.status === 'Pending for Approval';
                    return isMatchingType && isPending;
                });

                console.log(`Pending requests for ${leaveType.typeName}:`, pendingRequests);

                let totalPendingDays = 0;
                pendingRequests.forEach(request => {
                    const fromDate = new Date(request.fromDate);
                    const untilDate = new Date(request.untilDate);
                    let days = Math.ceil((untilDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
                    
                    // Adjust for half days
                    if (request.fromDayType === 'half_day') days -= 0.5;
                    if (request.untilDayType === 'half_day') days -= 0.5;
                    
                    console.log(`Request ${request.leaveRequestId}: ${days} days`);
                    totalPendingDays += days;
                });

                // Calculate effective remaining leaves
                const effectiveRemainingLeaves = Math.max(0, currentBalance.remainingLeaves - totalPendingDays);
                
                console.log(`${leaveType.typeName} final calculation:`);
                console.log(`  Database: ${currentBalance.remainingLeaves}`);
                console.log(`  Pending: ${totalPendingDays}`);
                console.log(`  Effective: ${effectiveRemainingLeaves}`);
                
                return {
                    leaveTypeId: leaveType.leaveTypeId,
                    typeName: leaveType.typeName,
                    totalLeaves: currentBalance.totalLeaves,
                    usedLeaves: currentBalance.usedLeaves,
                    remainingLeaves: effectiveRemainingLeaves
                };
            });
            
            const leaveBalances = await Promise.all(leaveBalancesPromises);
            console.log('\n=== API Response - Final leave balances ===');
            leaveBalances.forEach(balance => {
                console.log(`${balance.typeName}: ${balance.remainingLeaves} remaining`);
            });
            
            res.status(200).json({ leaveBalances });
        } catch (error) {
            console.error('Error fetching leave balances:', error.message);
            res.status(500).json({ message: 'Internal server error', error: error.message });
        }
    } else {
        console.log('Unauthorized access: No session user or not an employee');
        res.status(401).json({ message: 'Unauthorized access' });
    }
},
// previous getLeaveRequestsByUserId code without remainingLeaves edited,
// getLeaveRequestsByUserId: async function(req, res) {
//     console.log('Fetching leave balances for user...');

//     if (req.session.user && req.session.user.userRole === 'Employee') {
//         try {
//             // Step 1: Fetch active leave types
//             const { data: activeLeaveTypes, error: leaveTypesError } = await supabase
//                 .from('leave_types')
//                 .select('leaveTypeId, typeName')
//                 .eq('typeIsActive', true);

//             if (leaveTypesError) {
//                 console.error('Error fetching leave types:', leaveTypesError.message);
//                 throw leaveTypesError;
//             }

//             console.log('Fetched active leave types:', activeLeaveTypes);

//             // Step 2: Fetch leave balances for the logged-in employee using userId
//             const leaveBalancesPromises = activeLeaveTypes.map(async (leaveType) => {
//                 const { data: leaveBalance, error: balanceError } = await supabase
//                     .from('leavebalances')
//                     .select('totalLeaves, usedLeaves, remainingLeaves') // Fetch all relevant fields
//                     .eq('userId', req.session.user.userId) // Use userId
//                     .eq('leaveTypeId', leaveType.leaveTypeId)
//                     .single();

//                 if (balanceError || !leaveBalance) {
//                     console.warn(`No leave balance found for ${leaveType.typeName}. Defaulting to max count.`);
//                     return {
//                         leaveTypeId: leaveType.leaveTypeId,
//                         typeName: leaveType.typeName,
//                         totalLeaves: leaveType.typeMaxCount,
//                         usedLeaves: 0,
//                         remainingLeaves: leaveType.typeMaxCount
//                     };
//                 }

//                 return {
//                     leaveTypeId: leaveType.leaveTypeId,
//                     typeName: leaveType.typeName,
//                     totalLeaves: leaveBalance.totalLeaves,
//                     usedLeaves: leaveBalance.usedLeaves,
//                     remainingLeaves: leaveBalance.remainingLeaves
//                 };
//             });

//             const leaveBalances = await Promise.all(leaveBalancesPromises);
//             console.log('Fetched leave balances:', leaveBalances);

//             // Step 3: Fetch leave requests for the logged-in employee
//             const { data: leaveRequests, error: leaveRequestsError } = await supabase
//                 .from('leaverequests')
//                 .select('leaveTypeId, fromDate, untilDate, reason, status') // Include reason and status
//                 .eq('userId', req.session.user.userId) // Use userId
//                 .order('fromDate', { ascending: false }); // Order by date descending

//             if (leaveRequestsError) {
//                 console.error('Error fetching leave requests:', leaveRequestsError.message);
//                 throw leaveRequestsError;
//             }

//             console.log('Fetched leave requests:', leaveRequests);

//             res.status(200).json({ leaveBalances, leaveRequests });
//         } catch (error) {
//             console.error('Error fetching leave balances and requests:', error.message);
//             res.status(500).json({ message: 'Internal server error', error: error.message });
//         }
//     } else {
//         console.log('Unauthorized access: No session user or not an employee');
//         res.status(401).json({ message: 'Unauthorized access' });
//     }
// },

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

    const userId = req.session.user.userId;

    try {
        // Fetch user details associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, departmentId, firstName, lastName')
            .eq('userId', userId)
            .single();

        console.log('User Data:', userData);
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
            .select('*')
            .eq('userId', userId)
            .order('attendanceDate', { ascending: false });

        if (attendanceError) {
            console.error('Attendance Fetch Error:', attendanceError);
            return res.status(500).json({ message: 'Error fetching attendance records', error: attendanceError.message });
        }

        // Log the fetched attendance records
        console.log('Attendance Records:', attendanceRecords);

        // Get today's date and current time
        const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const currentTime = new Date().toTimeString().split(' ')[0]; // HH:mm:ss

        // Render the attendance page with the attendance records and user details
        return res.render('staffpages/employee_pages/employeeattendance', {
            user: {
                staffId,
                departmentId,
                firstName,
                lastName
            },
            records: attendanceRecords || [],
            todayDate,
            currentTime,
            message: 'Attendance records retrieved successfully'
        });

    } catch (error) {
        // Log and respond with error in case of failure
        console.error('Error retrieving attendance records:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
},

postAttendance: async function (req, res) {
    // Check if the user is authenticated
    if (!req.session.user || !req.session.user.userId) {
        return res.status(401).json({ message: 'Unauthorized access' });
    }

    // Destructure the relevant fields from the request body
    const { attendanceAction, attendanceTime, selectedDate, latitude, longitude, city } = req.body; // Include selectedDate if available

    // Ensure mandatory fields are provided
    if (!attendanceAction || !attendanceTime) {
        return res.status(400).json({ message: 'Attendance action and time, and location are required.' });
    }

    try {
        // Fetch staffId and user details associated with the userId
        const { data: userData, error: fetchError } = await supabase
            .from('staffaccounts')
            .select('staffId, firstName, lastName, officeLatitude, officeLongitude')
            .eq('userId', req.session.user.userId)
            .single();

        if (fetchError || !userData) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { staffId, firstName, lastName, officeLatitude, officeLongitude } = userData;

        // Function to calculate distance between two coordinates
        function getDistance(lat1, lon1, lat2, lon2) {
            const toRad = x => x * Math.PI / 180;
            const R = 6371; // Radius of Earth in km
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c * 1000; // Convert to meters
        }

        // Determine the attendance date (use selectedDate or default to yesterday's date)
        const currentDate = new Date();
        const today = currentDate.toISOString().split('T')[0];

        const attendanceDate = selectedDate || today; // Use selectedDate or yesterday if not provided

        // Insert the attendance record into the attendance table using userId
        const { error: insertError } = await supabase
            .from('attendance')
            .insert([
                {
                    userId: req.session.user.userId,  // Add userId directly
                    attendanceDate,                   // Use selectedDate or default to yesterday
                    attendanceTime,                   // User-provided time
                    attendanceAction,                  // Action: Time In or Time Out
                    latitude,
                    longitude,
                    city
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


getViewPerformanceTimeline: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Employee') {
        try {
            const userId = req.session.user.userId;
            
            // Fetch employee job information
            const { data: staffData, error: staffError } = await supabase
                .from("staffaccounts")
                .select("jobId")
                .eq("userId", userId)
                .single();
            
            if (staffError) {
                console.error("Error fetching staff data:", staffError);
                return res.status(500).render('error', { message: 'Error fetching staff information' });
            }
            
            const jobId = staffData.jobId;
            
            // 1. Fetch objective settings
            const { data: objectivesData, error: objectivesError } = await supabase
                .from("objectivesettings")
                .select(`
                    objectiveSettingsId,
                    performancePeriodYear,
                    objectivesettings_objectives (
                        objectiveId,
                        objectiveDescrpt,
                        objectiveKPI,
                        objectiveTarget,
                        objectiveUOM,
                        objectiveAssignedWeight
                    )
                `)
                .eq("userId", userId)
                .order('created_at', { ascending: false })
                .limit(1);
            
            if (objectivesError) {
                console.error("Error fetching objectives:", objectivesError);
            }
            
            // 2. Fetch job required skills
            const { data: skillsData, error: skillsError } = await supabase
                .from("jobreqskills")
                .select("*")
                .eq("jobId", jobId);
            
            if (skillsError) {
                console.error("Error fetching job skills:", skillsError);
            }
            
            // 3a. First fetch Q1 data without trying to join the problematic tables
            const { data: q1Data, error: q1Error } = await supabase
                .from("feedbacks_Q1")
                .select("*")
                .eq("userId", userId)
                .eq("year", new Date().getFullYear());
            
            if (q1Error) {
                console.error("Error fetching Q1 feedback:", q1Error);
            }
            
            // 3b. If we have Q1 data, fetch the answers separately
            let q1Answers = [];
            let objectiveScores = {};
            let skillScores = {};
            
            if (q1Data && q1Data.length > 0) {
                const feedbackQ1Id = q1Data[0].feedbackq1_Id;
                
                // Get feedback answers
                const { data: answersData, error: answersError } = await supabase
                    .from("feedbacks_answers")
                    .select("feedbackId_answerId, reviewerUserId, remarks")
                    .eq("feedbackq1_Id", feedbackQ1Id);
                
                if (answersError) {
                    console.error("Error fetching Q1 answers:", answersError);
                } else if (answersData && answersData.length > 0) {
                    q1Answers = answersData;
                    
                    // For each answer, get objectives feedback and skills feedback
                    for (const answer of answersData) {
                        // Get objective feedback
                        const { data: objectiveFeedback, error: objError } = await supabase
                            .from("feedbacks_answers-objectives")
                            .select("feedback_qObjectivesId, objectiveQuantInput, objectiveQualInput")
                            .eq("feedback_answerObjectivesId", answer.feedbackId_answerId);
                        
                        if (!objError && objectiveFeedback) {
                            // Process objective scores
                            objectiveFeedback.forEach(objFeedback => {
                                const feedbackQObjectivesId = objFeedback.feedback_qObjectivesId;
                                if (objFeedback.objectiveQuantInput) {
                                    if (!objectiveScores[feedbackQObjectivesId]) {
                                        objectiveScores[feedbackQObjectivesId] = [];
                                    }
                                    objectiveScores[feedbackQObjectivesId].push(objFeedback.objectiveQuantInput);
                                }
                            });
                        }
                        
                        // Get skills feedback
                        const { data: skillsFeedback, error: skillsError } = await supabase
                            .from("feedbacks_answers-skills")
                            .select("feedback_qSkillsId, skillsQuantInput, skillsQualInput")
                            .eq("feedback_answerSkillsId", answer.feedbackId_answerId);
                        
                        if (!skillsError && skillsFeedback) {
                            // Process skills scores
                            skillsFeedback.forEach(skillFeedback => {
                                const feedbackQSkillsId = skillFeedback.feedback_qSkillsId;
                                if (skillFeedback.skillsQuantInput) {
                                    if (!skillScores[feedbackQSkillsId]) {
                                        skillScores[feedbackQSkillsId] = [];
                                    }
                                    skillScores[feedbackQSkillsId].push(skillFeedback.skillsQuantInput);
                                }
                            });
                        }
                    }
                    
                    // Calculate average scores for objectives and skills
                    for (const [id, scores] of Object.entries(objectiveScores)) {
                        objectiveScores[id] = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
                    }
                    
                    for (const [id, scores] of Object.entries(skillScores)) {
                        skillScores[id] = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
                    }
                }
            }
            
            // 4. Similarly fetch Q2, Q3, Q4 data (without trying the complex joins)
            const { data: q2Data, error: q2Error } = await supabase
                .from("feedbacks_Q2")
                .select("*")
                .eq("userId", userId)
                .eq("year", new Date().getFullYear());
            
            if (q2Error) {
                console.error("Error fetching Q2 feedback:", q2Error);
            }
            
            const { data: q3Data, error: q3Error } = await supabase
                .from("feedbacks_Q3")
                .select("*")
                .eq("userId", userId)
                .eq("year", new Date().getFullYear());
            
            if (q3Error) {
                console.error("Error fetching Q3 feedback:", q3Error);
            }
            
            const { data: q4Data, error: q4Error } = await supabase
                .from("feedbacks_Q4")
                .select("*")
                .eq("userId", userId)
                .eq("year", new Date().getFullYear());
            
            if (q4Error) {
                console.error("Error fetching Q4 feedback:", q4Error);
            }
            
            // 5. Fetch mid-year IDP data
            const { data: midYearData, error: midYearError } = await supabase
                .from("midyearidps")
                .select("*")
                .eq("userId", userId)
                .order('created_at', { ascending: false })
                .limit(1);
            
            if (midYearError) {
                console.error("Error fetching mid-year IDP:", midYearError);
            }
            
            // 6. Fetch final-year IDP data
            const { data: finalYearData, error: finalYearError } = await supabase
                .from("finalyearidps")
                .select("*")
                .eq("userId", userId)
                .order('created_at', { ascending: false })
                .limit(1);
            
            if (finalYearError) {
                console.error("Error fetching final-year IDP:", finalYearError);
            }
            
            // Process objectives for display
            let objectives = [];
            
            if (objectivesData && objectivesData.length > 0 && objectivesData[0].objectivesettings_objectives) {
                objectives = objectivesData[0].objectivesettings_objectives;
            }
            
            // Process skills data
            let hardSkills = [];
            let softSkills = [];
            
            if (skillsData) {
                skillsData.forEach(skill => {
                    if (skill.jobReqSkillType === 'Hard') {
                        hardSkills.push(skill);
                    } else if (skill.jobReqSkillType === 'Soft') {
                        softSkills.push(skill);
                    }
                });
            }
            
            // Create stepper progress data
            const steps = [
                { 
                    id: 'objectiveSettingForm', 
                    completed: objectives.length > 0,
                    name: 'Objective Setting',
                    icon: 'fa-bullseye'
                },
                { 
                    id: 'quarterlyProgress1', 
                    completed: q1Data && q1Data.length > 0,
                    name: '[1/4] 360° Feedback',
                    icon: 'fa-users'
                },
                { 
                    id: 'quarterlyProgress2', 
                    completed: q2Data && q2Data.length > 0,
                    name: '[2/4] 360° Feedback',
                    icon: 'fa-users' 
                },
                { 
                    id: 'midYearReview', 
                    completed: midYearData && midYearData.length > 0,
                    name: 'Mid-Year IDP',
                    icon: 'fa-clipboard-check'
                },
                { 
                    id: 'quarterlyProgress3', 
                    completed: q3Data && q3Data.length > 0,
                    name: '[3/4] 360° Feedback',
                    icon: 'fa-users'
                },
                { 
                    id: 'quarterlyProgress4', 
                    completed: q4Data && q4Data.length > 0,
                    name: '[4/4] 360° Feedback',
                    icon: 'fa-users'
                },
                { 
                    id: 'yearEndReview', 
                    completed: finalYearData && finalYearData.length > 0,
                    name: 'Final-Year IDP',
                    icon: 'fa-clipboard-check'
                }
            ];
            
            // Find the current active step
            let currentStep = steps.findIndex(step => !step.completed);
            if (currentStep === -1) currentStep = steps.length - 1; // All completed
            
            // Prepare IDPs if available
            const midYearIDP = midYearData && midYearData.length > 0 ? midYearData[0] : null;
            const finalYearIDP = finalYearData && finalYearData.length > 0 ? finalYearData[0] : null;
            
            // Render the page with all data
            res.render('staffpages/employee_pages/employee-viewtimeline', {
                objectives,
                objectiveScores,
                hardSkills,
                softSkills,
                skillScores,
                steps,
                currentStep,
                midYearIDP,
                finalYearIDP,
                quarterlyData: {
                    q1: q1Data && q1Data.length > 0 ? q1Data[0] : null,
                    q2: q2Data && q2Data.length > 0 ? q2Data[0] : null,
                    q3: q3Data && q3Data.length > 0 ? q3Data[0] : null,
                    q4: q4Data && q4Data.length > 0 ? q4Data[0] : null
                }
            });
            
        } catch (error) {
            console.error("Error in getViewPerformanceTimeline:", error);
            res.status(500).render('error', { message: 'An error occurred while retrieving performance data' });
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
        res.redirect('/staff/login');
    }
},



/* ---------- NOTIFICATION DIVIDER ---------- */


get360FeedbackToast: async function(req, res) {
    try {
        console.log("Entering get360FeedbackToast function for employee");

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
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        const { data: currentUserData, error: userError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', currentUserId)
            .single();

        if (userError || !currentUserData) {
            console.error("Error fetching user details:", userError);
            return res.status(404).json({ success: false, message: 'User details not found.' });
        }

        const { departmentId } = currentUserData;

        // Step 3: Loop through each feedback table (Q1 to Q4) and fetch the active feedback record
        for (const feedbackTable of feedbackTables) {
            console.log(`Fetching data from table: ${feedbackTable}...`);

            const { data, error } = await supabase
                .from(feedbackTable)
                .select('*')
                .lte('setStartDate', todayString) // Check for feedback periods that started today or earlier
                .gte('setEndDate', todayString);  // Check for feedback periods that end today or later

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
                    // Extract the quarter from the table name (e.g., 'feedbacks_Q1' -> 'Q1')
                    const tableQuarter = feedbackTable.split('_')[1];
                    activeFeedback.quarter = tableQuarter;
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
            return res.status(404).json({ 
                success: false, 
                message: 'No active feedback records found for the given date range.' 
            });
        }

        // Step 6: Return the active feedback record with additional user ID for the frontend
        return res.status(200).json({ 
            success: true, 
            feedback: activeFeedback, 
            quarter: activeFeedback.quarter,
            userId: currentUserId
        });

    } catch (error) {
        console.error('Error in get360FeedbackToast:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while fetching feedback data.', 
            error: error.message 
        });
    }
},

getFeedbackUsers: async function(req, res) {
    const currentUserId = req.session?.user?.userId;
    const quarter = req.query.quarter || null;

    if (!currentUserId) {
        console.error("Error: No user ID available in session.");
        return res.status(400).json({ message: 'User ID is required.' });
    }

    try {
        // Your existing code...
        
        // Determine which feedback table to query based on quarter parameter
        let feedbackTable;
        let feedbackIdField;
        
        if (quarter === 'Q1') {
            feedbackTable = 'feedbacks_Q1';
            feedbackIdField = 'feedbackq1_Id';
        } else if (quarter === 'Q2') {
            feedbackTable = 'feedbacks_Q2';
            feedbackIdField = 'feedbackq2_Id';
        } else if (quarter === 'Q3') {
            feedbackTable = 'feedbacks_Q3';
            feedbackIdField = 'feedbackq3_Id';
        } else if (quarter === 'Q4') {
            feedbackTable = 'feedbacks_Q4';
            feedbackIdField = 'feedbackq4_Id';
        } else {
            // If no quarter specified, use today's date to determine the quarter
            const today = new Date();
            const month = today.getMonth() + 1; // getMonth() returns 0-11
            
            if (month <= 3) {
                feedbackTable = 'feedbacks_Q1';
                feedbackIdField = 'feedbackq1_Id';
            } else if (month <= 6) {
                feedbackTable = 'feedbacks_Q2';
                feedbackIdField = 'feedbackq2_Id';
            } else if (month <= 9) {
                feedbackTable = 'feedbacks_Q3';
                feedbackIdField = 'feedbackq3_Id';
            } else {
                feedbackTable = 'feedbacks_Q4';
                feedbackIdField = 'feedbackq4_Id';
            }
        }
        
        // Continue with your existing logic but focus on the selected quarter's table
        // ...
        
        // Continue with rest of your function
    } catch (error) {
        console.error('Error in getFeedbackUsers:', error);
        return res.status(500).json({ success: false, message: 'An error occurred while fetching feedback data.', error: error.message });
    }
},

getNotificationSection_360DegreeFeedback: async function(req, res) {
    try {
        console.log("Entering getNotificationSection_360DegreeFeedback function");

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

        // Step 6: Return the active feedback record along with start and end dates
        console.log('Active feedback found:', activeFeedback);

        // Assuming the quarter is fetched from the record
        const quarter = activeFeedback.quarter; // Adjust to get the actual quarter from the data const startDate = activeFeedback.setStartDate; // Adjust according to your data structure
        const endDate = activeFeedback.setEndDate; // Adjust according to your data structure

        return res.status(200).json({ 
            success: true, 
            feedback: activeFeedback, 
            quarter, 
            startDate: activeFeedback.setStartDate, // Ensure this is correct
            endDate: activeFeedback.setEndDate // Ensure this is correct
        });

    } catch (error) {
        console.error('Error in getNotificationSection_360DegreeFeedback:', error);
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

        const { departmentId, jobId,  departments: { deptName } = {}, jobpositions: { jobTitle } = {} = {} } = currentUserData;

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
                .select(`userId, setStartDate, setEndDate, ${idField}, quarter`)  // Add the 'quarter' field
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
                feedback: {
                    ...feedback,
                    quarter: feedback.quarter // Add the quarter information
                },
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

        // Return response with deptName and jobTitle
        return res.status(200).json({
            success: true,
            user: {
                ...currentUserData,
                deptName, // Department Name
                jobTitle, // Job Title
            },
            feedbackDetails,
            hardSkills,
            softSkills,
        });

    } catch (error) {
        console.error('Error in get360FeedbackList:', error);
        return res.status(500).json({ message: 'An error occurred while fetching feedback data.', error: error.message });
    }
},

staffFeedbackList: async function (req, res) {
    console.log("staffFeedbackList function called!");
    const currentUserId = req.session?.user?.userId;
    const quarter = req.query.quarter || 'Q1'; // Default to Q1 if not provided
    
    if (!currentUserId) {
        return res.status(400).json({
            success: false,
            error: 'Authentication Required',
            message: 'Please log in to access this page.'
        });
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
            return res.status(404).json({
                success: false,
                error: 'User Not Found',
                message: 'Unable to retrieve your user information.'
            });
        }
        
        const { departmentId } = currentUserData;
        
        // Fetch all staff members in the same department
        const { data: staffList, error: staffError } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName,
                jobpositions (jobTitle)
            `)
            .eq('departmentId', departmentId)
            .neq('userId', currentUserId); // Exclude current user
        
        if (staffError) {
            console.error("Error fetching staff list:", staffError);
            return res.status(500).json({
                success: false,
                error: 'Data Fetch Error',
                message: 'Unable to retrieve department staff list.'
            });
        }
        
        // Get the list of users who have feedback data for each quarter
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const usersWithDataByQuarter = {};
        
        for (const q of quarters) {
            usersWithDataByQuarter[q] = [];
            
            // First, get users who have data in the main quarterly feedback table
            const { data: feedbackData, error: feedbackError } = await supabase
                .from(`feedbacks_${q}`)
                .select('userId, feedbackq' + q.substring(1) + '_Id');
                
            if (feedbackError) {
                console.error(`Error fetching ${q} feedback data:`, feedbackError);
                continue;
            }
            
            // Create a set of unique user IDs with feedback data
            const userIdsWithFeedback = new Set();
            const feedbackIds = {};
            
            // Collect all user IDs and their corresponding feedback IDs
            feedbackData.forEach(item => {
                userIdsWithFeedback.add(item.userId);
                const fbIdKey = 'feedbackq' + q.substring(1) + '_Id';
                feedbackIds[item.userId] = item[fbIdKey];
            });
            
            // If no users have feedback data for this quarter, continue to next quarter
            if (userIdsWithFeedback.size === 0) {
                continue;
            }
            
            // For each user with feedback, check if they have objectives and skills data
            for (const userId of userIdsWithFeedback) {
                const feedbackId = feedbackIds[userId];
                
                // Check for data in feedbacks_questions-objectives using the feedback ID
                const { data: objectivesData, error: objectivesError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('feedback_qObjectivesId')
                    .eq('feedbackq' + q.substring(1) + '_Id', feedbackId)
                    .limit(1);
                    
                if (objectivesError) {
                    console.error(`Error fetching ${q} objectives data:`, objectivesError);
                    continue;
                }
                
                // Check for data in feedbacks_questions-skills using the feedback ID
                const { data: skillsData, error: skillsError } = await supabase
                    .from('feedbacks_questions-skills')
                    .select('feedback_qSkillsId')
                    .eq('feedbackq' + q.substring(1) + '_Id', feedbackId)
                    .limit(1);
                    
                if (skillsError) {
                    console.error(`Error fetching ${q} skills data:`, skillsError);
                    continue;
                }
                
                // Only add user to the list if they have data in ALL THREE tables
                if (objectivesData.length > 0 && skillsData.length > 0) {
                    usersWithDataByQuarter[q].push(userId);
                }
            }
        }
        
        // Format the staff list with quarter availability info
        const formattedStaffList = staffList.map(staff => {
            const availableQuarters = {};
            
            quarters.forEach(q => {
                availableQuarters[q] = usersWithDataByQuarter[q].includes(staff.userId);
            });
            
            return {
                userId: staff.userId,
                firstName: staff.firstName,
                lastName: staff.lastName,
                jobTitle: staff.jobpositions?.jobTitle || 'Employee',
                availableQuarters: availableQuarters
            };
        });
        
        // Filter staff list for the selected quarter
        const filteredStaffList = formattedStaffList.filter(staff => 
            staff.availableQuarters[quarter]
        );
        
        // Check if any data exists for this quarter
        const hasQuarterData = filteredStaffList.length > 0;
        
        console.log(`Found ${filteredStaffList.length} staff members with data for ${quarter}`);
        
        // Render the staff feedback list page
        return res.render('staffpages/employee_pages/employee-quarterlyfeedbackquestionnaire.ejs', {
            title: '360 Degree Feedback Questionnaires',
            quarter: quarter,
            staffList: filteredStaffList,
            allStaffList: formattedStaffList, // Send all staff for client-side filtering
            hasQuarterData: hasQuarterData, // New flag indicating if quarter has data
            user: req.session.user
        });
        
    } catch (error) {
        console.error('Error in staffFeedbackList:', error);
        return res.status(500).json({
            success: false,
            error: 'Server Error',
            message: 'An unexpected error occurred. Please try again later.'
        });
    }
},

// API endpoint to get questionnaire data for a specific staff member
getQuestionnaireData: async function (req, res) {
    const currentUserId = req.session?.user?.userId;
    const targetUserId = req.query.userId;
    const quarter = req.query.quarter || 'Q1';
    
    if (!currentUserId || !targetUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'User IDs are required.'
        });
    }
    
    try {
        // Get table name and ID field based on quarter
        const quarterTable = `feedbacks_${quarter}`;
        const idField = `feedback${quarter.toLowerCase()}_Id`;
        
        // Fetch feedback data for the target user
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(quarterTable)
            .select(`
                userId, 
                setStartDate, 
                setEndDate, 
                ${idField},
                quarter,
                year
            `)
            .eq('userId', targetUserId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (feedbackError) {
            console.error(`Error fetching feedback data:`, feedbackError);
            return res.status(404).json({ 
                success: false, 
                message: 'No feedback data found for this user.'
            });
        }

        if (!feedbackData || feedbackData.length === 0) {
            console.log(`No feedback data found for user ${targetUserId} in ${quarterTable}`);
            return res.status(404).json({
                success: false,
                message: 'No feedback data found for this user.'
            });
        }

        const feedback = feedbackData[0];
        const feedbackId = feedback[idField];

        console.log(`Found feedback record with ID ${feedbackId}`);
        
        // Fetch user details for additional information
        const { data: userData, error: userError } = await supabase
            .from('staffaccounts')
            .select(`
                departments (deptName),
                jobpositions (jobTitle),
                jobId
            `)
            .eq('userId', targetUserId)
            .single();
            
        if (userError) {
            console.error("Error fetching user data:", userError);
        } else if (userData) {
            // Add department and job title to feedback data
            feedback.deptName = userData.departments?.deptName;
            feedback.jobTitle = userData.jobpositions?.jobTitle;
            
            // Use jobId from user data if not available in feedback
            if (!feedback.jobId && userData.jobId) {
                feedback.jobId = userData.jobId;
            }
        }

        // Add an id field for easier reference in the frontend
        feedback.id = feedbackId;

        // Construct OR condition string for feedback ID fields
        const orCondition = `feedbackq1_Id.eq.${feedbackId},feedbackq2_Id.eq.${feedbackId},feedbackq3_Id.eq.${feedbackId},feedbackq4_Id.eq.${feedbackId}`;
        console.log(`Using OR condition: ${orCondition}`);
        
        // Fetch objectives for this feedback using OR condition for ID fields
        const { data: objectivesData, error: objectivesError } = await supabase
            .from('feedbacks_questions-objectives')
            .select(`
                feedback_qObjectivesId,
                objectiveId,
                objectiveQualiQuestion
            `)
            .or(orCondition);
            
        if (objectivesError) {
            console.error("Error fetching objectives:", objectivesError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching objectives data.'
            });
        }

        console.log(`Found ${objectivesData?.length || 0} objectives`);
        
        // Get detailed objective information
        let objectives = [];
        if (objectivesData && objectivesData.length > 0) {
            const objectiveIds = objectivesData.map(obj => obj.objectiveId);
            
            const { data: objectiveDetails, error: objectiveDetailsError } = await supabase
                .from('objectivesettings_objectives')
                .select('*')
                .in('objectiveId', objectiveIds);
                
            if (objectiveDetailsError) {
                console.error("Error fetching objective details:", objectiveDetailsError);
            } else if (objectiveDetails) {
                console.log(`Found ${objectiveDetails.length} objective details`);
                
                // Combine the data
                objectives = objectivesData.map(obj => {
                    const detail = objectiveDetails.find(d => d.objectiveId === obj.objectiveId);
                    return {
                        ...obj,
                        ...detail,
                        // Ensure these fields are properly mapped for frontend
                        objectiveDescription: detail?.objectiveDescrpt, // Match the DB field name
                        description: detail?.objectiveDescrpt, // Add an alias for convenience
                        kpi: detail?.objectiveKPI,
                        target: detail?.objectiveTarget,
                        uom: detail?.objectiveUOM,
                        weight: detail?.objectiveAssignedWeight
                    };
                });
            } else {
                objectives = objectivesData;
            }
        }
        
        // Fetch job requirement skills
        let jobId = feedback.jobId;
        if (!jobId && userData) {
            jobId = userData.jobId;
        }
        
        // If still no jobId, fetch it explicitly
        if (!jobId) {
            const { data: jobData, error: jobError } = await supabase
                .from('staffaccounts')
                .select('jobId')
                .eq('userId', targetUserId)
                .single();
                
            if (jobError) {
                console.error("Error fetching job ID:", jobError);
            } else if (jobData) {
                jobId = jobData.jobId;
            }
        }
        
        if (!jobId) {
            console.error("No job ID found for user", targetUserId);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching job data.'
            });
        }
        
        console.log(`Using jobId: ${jobId} to fetch skills`);
        
        // Fetch all skills for this job
        const { data: skillsData, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('*')
            .eq('jobId', jobId);
            
        if (skillsError) {
            console.error("Error fetching skills:", skillsError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching skills data.'
            });
        }

        console.log(`Found ${skillsData?.length || 0} total skills`);

        // Separate hard and soft skills
        const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
        const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];
        
        console.log(`Hard skills: ${hardSkills.length}, Soft skills: ${softSkills.length}`);

        // Check if feedback is already submitted by this reviewer
        const { data: existingFeedback, error: existingFeedbackError } = await supabase
            .from('feedbacks_answers')
            .select('feedbackId_answerId')
            .eq(idField, feedbackId)
            .eq('reviewerUserId', currentUserId)
            .limit(1);
            
        const isSubmitted = existingFeedback && existingFeedback.length > 0;
        console.log(`Feedback already submitted by this reviewer: ${isSubmitted}`);

        // Return all data
        return res.json({
            success: true,
            feedback,
            objectives,
            hardSkills,
            softSkills
        });
        
    } catch (error) {
        console.error('Error in getQuestionnaireData:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while fetching questionnaire data.'
        });
    }
},

// API endpoint to submit feedback
submitFeedback: async function (req, res) {
    const currentUserId = req.session?.user?.userId;
    const { 
        feedbackId, 
        quarter,
        userId, 
        objectives = [], 
        hardSkills = [], 
        softSkills = [] 
    } = req.body;
    
    console.log("Submit feedback request received:", {
        reviewerUserId: currentUserId,
        targetUserId: userId,
        quarter,
        feedbackId,
        objectivesCount: objectives.length,
        hardSkillsCount: hardSkills.length,
        softSkillsCount: softSkills.length
    });
    
    if (!currentUserId || !feedbackId || !quarter || !userId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters.'
        });
    }
    
    try {
        // Determine which feedback ID field to use based on quarter (q1, q2, q3, q4)
        // The schema shows feedbackq1_Id, feedbackq2_Id, etc.
        const quarterNum = quarter.charAt(1); // Extract the number from "Q1", "Q2", etc.
        const idField = `feedbackq${quarterNum}_Id`;
        
        // Check if feedback was already submitted
        const { data: existingFeedback, error: existingFeedbackError } = await supabase
            .from('feedbacks_answers')
            .select('feedbackId_answerId')
            .eq(idField, feedbackId)
            .eq('reviewerUserId', currentUserId)
            .limit(1);
            
        if (existingFeedbackError) {
            console.error("Error checking existing feedback:", existingFeedbackError);
        } else if (existingFeedback && existingFeedback.length > 0) {
            console.log("Feedback already submitted by this reviewer");
            return res.json({
                success: false,
                message: 'You have already submitted feedback for this user.'
            });
        }
        
        // Insert feedback answers record
        const { data: answerData, error: answerError } = await supabase
            .from('feedbacks_answers')
            .insert({
                [idField]: feedbackId,
                reviewerUserId: currentUserId,
                userld: userId, // Note: following the schema's 'userld' spelling
                reviewDate: new Date().toISOString().split('T')[0],
                created_at: new Date()
            })
            .select();
            
        if (answerError || !answerData || answerData.length === 0) {
            console.error("Error inserting feedback answer:", answerError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error saving feedback answer.'
            });
        }
        
        const feedbackAnswerId = answerData[0].feedbackId_answerId;
        console.log(`Created feedback answer record with ID ${feedbackAnswerId}`);
        
        // First, get all the question-objective relationships for this quarter/feedback
        const { data: qObjectives, error: qObjError } = await supabase
            .from('feedbacks_questions-objectives')
            .select('feedback_qObjectivesId, objectiveId')
            .eq(idField, feedbackId);
            
        if (qObjError) {
            console.error("Error fetching question-objectives:", qObjError);
        }
        
        // Process objective answers with proper relationship IDs
        if (objectives.length > 0 && qObjectives && qObjectives.length > 0) {
            console.log(`Processing ${objectives.length} objectives`);
            
            try {
                // Map objective IDs to their corresponding question-objective IDs
                const objectiveMap = {};
                qObjectives.forEach(qObj => {
                    objectiveMap[qObj.objectiveId] = qObj.feedback_qObjectivesId;
                });
                
                // Prepare objective answers with correct relationship IDs
                const objectiveAnswers = objectives
                    .filter(obj => objectiveMap[obj.objectiveId]) // Only include objectives with relationships
                    .map(obj => ({
                        feedback_qObjectivesId: objectiveMap[obj.objectiveId],
                        objectiveQuantInput: parseInt(obj.quantitative) || 0,
                        objectiveQualInput: obj.qualitative || '',
                        created_at: new Date()
                    }));
                
                if (objectiveAnswers.length > 0) {
                    const { error: objAnswerError } = await supabase
                        .from('feedbacks_answers-objectives')
                        .insert(objectiveAnswers);
                        
                    if (objAnswerError) {
                        console.error("Error inserting objective answers:", objAnswerError);
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Error saving objective feedback.'
                        });
                    }
                    
                    console.log(`Saved ${objectiveAnswers.length} objective answers`);
                } else {
                    console.log("No objective answers to save - missing relationships");
                }
            } catch (insertError) {
                console.error("Error processing objective answers:", insertError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error processing objective feedback.'
                });
            }
        }
        
        // Get all the question-skills relationships for this quarter/feedback
        const { data: qSkills, error: qSkillsError } = await supabase
            .from('feedbacks_questions-skills')
            .select('feedback_qSkillsId, jobReqSkillId')
            .eq(idField, feedbackId);
            
        if (qSkillsError) {
            console.error("Error fetching question-skills:", qSkillsError);
        }
        
        // Combined skills processing for both hard and soft skills
        if (qSkills && qSkills.length > 0) {
            const allSkills = [...hardSkills, ...softSkills];
            console.log(`Processing ${allSkills.length} total skills`);
            
            try {
                // Map skill IDs to their corresponding question-skill IDs
                const skillMap = {};
                qSkills.forEach(qSkill => {
                    skillMap[qSkill.jobReqSkillId] = qSkill.feedback_qSkillsId;
                });
                
                // Prepare skill answers with correct relationship IDs
                const skillAnswers = allSkills
                    .filter(skill => skillMap[skill.skillId]) // Only include skills with relationships
                    .map(skill => ({
                        feedback_qSkillsId: skillMap[skill.skillId],
                        skillsQuantInput: parseInt(skill.quantitative) || 0,
                        skillsQualInput: skill.qualitative || '',
                        created_at: new Date()
                    }));
                
                if (skillAnswers.length > 0) {
                    const { error: skillAnswerError } = await supabase
                        .from('feedbacks_answers-skills')
                        .insert(skillAnswers);
                        
                    if (skillAnswerError) {
                        console.error("Error inserting skill answers:", skillAnswerError);
                        return res.status(500).json({ 
                            success: false, 
                            message: 'Error saving skills feedback.'
                        });
                    }
                    
                    console.log(`Saved ${skillAnswers.length} skill answers`);
                } else {
                    console.log("No skill answers to save - missing relationships");
                }
            } catch (insertError) {
                console.error("Error processing skill answers:", insertError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error processing skills feedback.'
                });
            }
        }
        
        // Return success response
        return res.json({
            success: true,
            message: 'Feedback submitted successfully.'
        });
        
    } catch (error) {
        console.error('Error in submitFeedback:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while submitting feedback.',
            error: error.message
        });
    }
},

// API endpoint to check if feedback has been submitted by the current user
checkFeedbackStatus: async function (req, res) {
    const currentUserId = req.session?.user?.userId;
    const targetUserId = req.query.userId;
    const quarter = req.query.quarter || 'Q1';
    
    if (!currentUserId || !targetUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'User IDs are required.'
        });
    }
    
    try {
        // Get appropriate ID field based on quarter
        const idField = `feedback${quarter.toLowerCase()}_Id`;
        
        // First get the feedback ID
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(`feedbacks_${quarter}`)
            .select(idField)
            .eq('userId', targetUserId)
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (feedbackError || !feedbackData || feedbackData.length === 0) {
            console.log(`No feedback found for user ${targetUserId} in quarter ${quarter}`);
            return res.json({
                success: true,
                submitted: false,
                message: 'No feedback record found'
            });
        }
        
        const feedbackId = feedbackData[0][idField];
        
        // Check if current user has submitted feedback
        const { data: answerData, error: answerError } = await supabase
            .from('feedbacks_answers')
            .select('feedbackId_answerId')
            .eq(idField, feedbackId)
            .eq('reviewerUserId', currentUserId)
            .limit(1);
            
        if (answerError) {
            console.error("Error checking feedback submission:", answerError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error checking feedback status.'
            });
        }
        
        return res.json({
            success: true,
            submitted: answerData && answerData.length > 0,
            message: answerData && answerData.length > 0 ? 'Feedback already submitted' : 'Feedback not yet submitted'
        });
        
    } catch (error) {
        console.error('Error in checkFeedbackStatus:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while checking feedback status.'
        });
    }
},


// ============================
// TRAINING MODULE CONTROLLER FUNCTIONS
// ============================


// Employee Training Section
getEmployeeTrainingHome: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Employee') {
            res.render('staffpages/employee_pages/training_pages/employee-training-home');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
            res.redirect('/staff/login');
        }
    },
getEmployeeTrainingSpecific: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        req.flash('errors', { authError: 'Unauthorized. Employee access only.' });
        return res.redirect('/staff/login');
    }

    try {
        const trainingRecordId = req.params.trainingRecordId;
        const userId = req.session.user.userId;
        
        console.log('Fetching training details for record:', trainingRecordId);
        
        // Fetch training record with complete training details
        const { data: trainingRecord, error: trainingError } = await supabase
            .from('training_records')
            .select(`
                *,
                trainings!inner (
                    trainingId,
                    trainingName,
                    trainingDesc,
                    isOnlineArrangement,
                    totalDuration,
                    address,
                    cost,
                    country
                )
            `)
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (trainingError || !trainingRecord) {
            console.error('Training record error:', trainingError);
            return res.status(404).json({ 
                success: false, 
                message: 'Training record not found' 
            });
        }

        // Fetch all training activities with their completion status
        const { data: activitiesData, error: activitiesError } = await supabase
            .from('training_activities')
            .select(`
                activityId,
                activityName,
                activityType,
                activityRemarks,
                estActivityDuration,
                trainingId
            `)
            .eq('trainingId', trainingRecord.trainings.trainingId);

        if (activitiesError) {
            console.error('Error fetching activities:', activitiesError);
        }

        // Fetch activity completion status for this training record
        const { data: activityStatus, error: statusError } = await supabase
            .from('training_records_activities')
            .select('*')
            .eq('trainingRecordId', trainingRecordId);

        if (statusError) {
            console.error('Error fetching activity status:', statusError);
        }

        // Merge activities with their status
        const activities = (activitiesData || []).map(activity => {
            const status = (activityStatus || []).find(s => s.activityId === activity.activityId);
            return {
                ...activity,
                status: status?.status || 'Not Started',
                dateStarted: status?.dateStarted || null,
                dateCompleted: status?.dateCompleted || null,
                trainingRecordActivityId: status?.trainingRecordActivityId || null
            };
        });

        // Fetch certificates for this training record (updated structure)
        const { data: certificateRecords, error: certificatesError } = await supabase
            .from('training_records_certificates')
            .select(`
                *,
                training_certifications!inner (
                    trainingCertTitle,
                    trainingCertDesc
                )
            `)
            .eq('trainingRecordId', trainingRecordId);

        if (certificatesError) {
            console.error('Error fetching certificates:', certificatesError);
        }

        // Process certificates data
        const certificates = (certificateRecords || []).map(cert => ({
            trainingRecordCertificateId: cert.trainingRecordCertificateId,
            certificate_url: cert.certificate_url,
            created_at: cert.created_at,
            trainingCertTitle: cert.training_certifications?.trainingCertTitle || 'Training Certificate',
            trainingCertDesc: cert.training_certifications?.trainingCertDesc || 'No description available'
        }));

        // Fetch objectives
        const { data: objectivesData, error: objectivesError } = await supabase
            .from('training_objectives')
            .select(`
                trainingObjectiveId,
                objectiveId,
                objectives!inner (
                    objectiveId,
                    objectiveDescrpt,
                    objectiveKPI
                )
            `)
            .eq('trainingId', trainingRecord.trainings.trainingId);

        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
        }

        // Fetch skills
        const { data: skillsData, error: skillsError } = await supabase
            .from('training_skills')
            .select(`
                trainingSkillsId,
                jobReqSkillId,
                jobreqskills!inner (
                    jobReqSkillId,
                    jobReqSkillName,
                    jobReqSkillType
                )
            `)
            .eq('trainingId', trainingRecord.trainings.trainingId);

        if (skillsError) {
            console.error('Error fetching skills:', skillsError);
        }

        const data = {
            trainingRecord: {
                ...trainingRecord,
                trainingName: trainingRecord.trainings.trainingName,
                trainingDesc: trainingRecord.trainings.trainingDesc,
                isOnlineArrangement: trainingRecord.trainings.isOnlineArrangement,
                totalDuration: trainingRecord.trainings.totalDuration,
                address: trainingRecord.trainings.address,
                cost: trainingRecord.trainings.cost,
                country: trainingRecord.trainings.country
            },
            activities: activities || [],
            objectives: objectivesData?.map(obj => obj.objectives) || [],
            skills: skillsData?.map(skill => skill.jobreqskills) || [],
            certificates: certificates || []
        };

        console.log('Training data prepared:', {
            trainingName: data.trainingRecord.trainingName,
            activitiesCount: data.activities.length,
            certificatesCount: data.certificates.length
        });

        res.render('staffpages/employee_pages/training_pages/employee-specific-training', { data });
    } catch (error) {
        console.error('Error fetching training details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch training details',
            error: error.message 
        });
    }
},

    getEmployeeTrainingRecords: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'Employee') {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Employee access only.' 
            });
        }

        try {
            const userId = req.session.user.userId;
            
            // Fetch training records with complete training details
            const { data: trainingRecords, error: recordsError } = await supabase
                .from('training_records')
                .select(`
                    *,
                    trainings!inner (
                        trainingId,
                        trainingName,
                        trainingDesc,
                        isOnlineArrangement,
                        totalDuration,
                        cost,
                        address,
                        country
                    )
                `)
                .eq('userId', userId)
                .eq('isApproved', true)
                .order('setStartDate', { ascending: false });

            if (recordsError) {
                console.error('Error fetching training records:', recordsError);
                throw recordsError;
            }

            // For each training record, get activity counts
            const enrichedRecords = await Promise.all(
                (trainingRecords || []).map(async (record) => {
                    try {
                        // Get total activities count for this training
                        const { count: totalActivities, error: totalError } = await supabase
                            .from('training_activities')
                            .select('*', { count: 'exact', head: true })
                            .eq('trainingId', record.trainings.trainingId);

                        // Get completed activities count for this specific training record
                        const { count: completedActivities, error: completedError } = await supabase
                            .from('training_records_activities')
                            .select('*', { count: 'exact', head: true })
                            .eq('trainingRecordId', record.trainingRecordId)
                            .eq('status', 'Completed');

                        if (totalError || completedError) {
                            console.error('Error counting activities:', totalError || completedError);
                        }

                        // Calculate training percentage based on completed activities
                        const percentage = totalActivities > 0 ? 
                            Math.round((completedActivities / totalActivities) * 100) : 0;

                        return {
                            ...record,
                            // Flatten training data for easier access
                            trainingName: record.trainings.trainingName,
                            trainingDesc: record.trainings.trainingDesc,
                            isOnlineArrangement: record.trainings.isOnlineArrangement,
                            totalDuration: record.trainings.totalDuration,
                            cost: record.trainings.cost,
                            address: record.trainings.address,
                            country: record.trainings.country,
                            // Activity counts
                            totalActivities: totalActivities || 0,
                            completedActivities: completedActivities || 0,
                            trainingPercentage: percentage
                        };
                    } catch (error) {
                        console.error('Error processing training record:', error);
                        return {
                            ...record,
                            trainingName: record.trainings?.trainingName || 'Unknown Training',
                            trainingDesc: record.trainings?.trainingDesc || '',
                            isOnlineArrangement: record.trainings?.isOnlineArrangement || false,
                            totalDuration: record.trainings?.totalDuration || 0,
                            cost: record.trainings?.cost || 0,
                            address: record.trainings?.address || '',
                            country: record.trainings?.country || '',
                            totalActivities: 0,
                            completedActivities: 0,
                            trainingPercentage: 0
                        };
                    }
                })
            );
            
            res.json({
                success: true,
                data: enrichedRecords
            });
        } catch (error) {
            console.error('Error fetching training records:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch training records',
                error: error.message 
            });
        }
    },

    getTrainingRecordDetails: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'Employee') {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Employee access only.' 
            });
        }

        try {
            const trainingRecordId = req.params.trainingRecordId;
            const userId = req.session.user.userId;
            
            // Fetch training record with training details
            const { data: trainingRecord, error: recordError } = await supabase
                .from('training_records')
                .select(`
                    *,
                    trainings!inner (
                        trainingId,
                        trainingName,
                        trainingDesc,
                        isOnlineArrangement,
                        totalDuration,
                        cost,
                        address,
                        country
                    )
                `)
                .eq('trainingRecordId', trainingRecordId)
                .eq('userId', userId)
                .single();

            if (recordError || !trainingRecord) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Training record not found' 
                });
            }

            // Fetch activities with completion status
            const { data: activitiesData, error: activitiesError } = await supabase
                .from('training_activities')
                .select(`
                    activityId,
                    activityName,
                    activityType,
                    activityRemarks,
                    estActivityDuration,
                    trainingId
                `)
                .eq('trainingId', trainingRecord.trainings.trainingId)
                .order('activityId');

            if (activitiesError) {
                console.error('Error fetching activities:', activitiesError);
            }

            // Fetch activity completion status
            const { data: activityStatus, error: statusError } = await supabase
                .from('training_records_activities')
                .select('*')
                .eq('trainingRecordId', trainingRecordId);

            if (statusError) {
                console.error('Error fetching activity status:', statusError);
            }

            // Merge activities with their status
            const activities = (activitiesData || []).map(activity => {
                const status = (activityStatus || []).find(s => s.activityId === activity.activityId);
                return {
                    ...activity,
                    status: status?.status || 'Not Started',
                    dateStarted: status?.dateStarted || null,
                    dateCompleted: status?.dateCompleted || null,
                    trainingRecordActivityId: status?.trainingRecordActivityId || null
                };
            });

            // Get activity counts
            const totalActivities = activities?.length || 0;
            const completedActivities = activities?.filter(
                activity => activity.status === 'Completed'
            ).length || 0;

            // Calculate percentage
            const percentage = totalActivities > 0 ? 
                Math.round((completedActivities / totalActivities) * 100) : 0;

            const enrichedRecord = {
                ...trainingRecord,
                trainingName: trainingRecord.trainings.trainingName,
                trainingDesc: trainingRecord.trainings.trainingDesc,
                isOnlineArrangement: trainingRecord.trainings.isOnlineArrangement,
                totalDuration: trainingRecord.trainings.totalDuration,
                cost: trainingRecord.trainings.cost,
                address: trainingRecord.trainings.address,
                country: trainingRecord.trainings.country,
                totalActivities,
                completedActivities,
                trainingPercentage: percentage,
                activities: activities || []
            };
            
            res.json({
                success: true,
                data: enrichedRecord
            });
        } catch (error) {
            console.error('Error fetching training record details:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch training record details',
                error: error.message 
            });
        }
    },

    // Additional helper method for training dropdown in modal
    getTrainingDropdown: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'Employee') {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Employee access only.' 
            });
        }

        try {
            const userId = req.session.user.userId;

            // Get user's job position
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('jobId')
                .eq('userId', userId)
                .single();

            if (staffError || !staffData) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Staff account not found' 
                });
            }

            // Fetch available trainings for the user's job position
            const { data: trainings, error: trainingsError } = await supabase
                .from('trainings')
                .select('*')
                .eq('jobId', staffData.jobId)
                .eq('isActive', true);

            if (trainingsError) {
                throw trainingsError;
            }

            res.json({
                success: true,
                data: trainings || []
            });
        } catch (error) {
            console.error('Error fetching training dropdown:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch available trainings',
                error: error.message 
            });
        }
    },

    // Method to get training skills and objectives for modal
    getTrainingDetails: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'Employee') {
            return res.status(401).json({ 
                success: false, 
                message: 'Unauthorized. Employee access only.' 
            });
        }

        try {
            const trainingId = req.params.trainingId;

            // Fetch objectives
            const { data: objectivesData, error: objectivesError } = await supabase
                .from('training_objectives')
                .select(`
                    trainingObjectiveId,
                    objectiveId,
                    objectives!inner (
                        objectiveId,
                        objectiveDescrpt,
                        objectiveKPI
                    )
                `)
                .eq('trainingId', trainingId);

            // Fetch skills
            const { data: skillsData, error: skillsError } = await supabase
                .from('training_skills')
                .select(`
                    trainingSkillsId,
                    jobReqSkillId,
                    jobreqskills!inner (
                        jobReqSkillId,
                        jobReqSkillName,
                        jobReqSkillType
                    )
                `)
                .eq('trainingId', trainingId);

            if (objectivesError || skillsError) {
                console.error('Error fetching training details:', objectivesError || skillsError);
            }

            const objectives = objectivesData?.map(item => item.objectives) || [];
            const skills = skillsData?.map(item => item.jobreqskills) || [];

            res.json({
                success: true,
                data: {
                    objectives,
                    skills
                }
            });
        } catch (error) {
            console.error('Error fetching training details:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch training details',
                error: error.message 
            });
        }
    },

// Method to get certificates
getCertificates: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const userId = req.session.user.userId;
        console.log(`[${new Date().toISOString()}] Fetching certificates for user ${userId}`);

        // Get all approved training records for this user
        const { data: userTrainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select('trainingRecordId')
            .eq('userId', userId)
            .eq('isApproved', true);

        if (recordsError) {
            console.error('Error fetching training records:', recordsError);
            throw recordsError;
        }

        if (!userTrainingRecords || userTrainingRecords.length === 0) {
            console.log(`No approved training records found for user ${userId}`);
            return res.json({
                success: true,
                data: []
            });
        }

        const trainingRecordIds = userTrainingRecords.map(record => record.trainingRecordId);
        console.log(`Found ${trainingRecordIds.length} training records for user ${userId}`);

        // Fetch certificates for user's training records
        const { data: certificates, error: certificatesError } = await supabase
            .from('training_records_certificates')
            .select(`
                trainingRecordCertificateId,
                certificate_url,
                created_at,
                trainingRecordId,
                training_records!inner (
                    trainingRecordId,
                    trainings!inner (
                        trainingName
                    )
                )
            `)
            .in('trainingRecordId', trainingRecordIds)
            .not('certificate_url', 'is', null)
            .order('created_at', { ascending: false }); // Fixed ordering syntax

        if (certificatesError) {
            console.error('Error fetching certificates:', certificatesError);
            throw certificatesError;
        }

        console.log(`Found ${certificates ? certificates.length : 0} certificates`);

        // Format the response and filter out certificates without URLs
        const formattedCertificates = (certificates || [])
            .filter(cert => cert.certificate_url && cert.certificate_url.trim() !== '')
            .map(cert => ({
                trainingRecordCertificateId: cert.trainingRecordCertificateId,
                certificate_url: cert.certificate_url,
                created_at: cert.created_at,
                trainingRecordId: cert.trainingRecordId,
                trainingName: cert.training_records?.trainings?.trainingName || 'Unknown Training'
            }));

        console.log(`Returning ${formattedCertificates.length} valid certificates`);

        res.json({
            success: true,
            data: formattedCertificates
        });

    } catch (error) {
        console.error('Error in getCertificates:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch certificates',
            error: error.message 
        });
    }
},

    getEmployeeTrainingProgress: async function(req, res) {
    // Authentication check
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const userId = req.session.user.userId;
        
        // Fetch training records with training details
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select(`
                *,
                trainings!inner (
                    trainingId,
                    trainingName,
                    trainingDesc,
                    isOnlineArrangement,
                    totalDuration
                )
            `)
            .eq('userId', userId)
            .eq('isApproved', true)
            .order('setStartDate', { ascending: false });

        if (recordsError) {
            console.error('Error fetching training progress:', recordsError);
            throw recordsError;
        }

        // Process each training record to get activity counts
        const enrichedRecords = await Promise.all(
            (trainingRecords || []).map(async (record) => {
                try {
                    // Get total activities count
                    const { count: totalActivities, error: totalError } = await supabase
                        .from('training_activities')
                        .select('*', { count: 'exact', head: true })
                        .eq('trainingId', record.trainings.trainingId);

                    // Get completed activities count
                    const { count: completedActivities, error: completedError } = await supabase
                        .from('training_records_activities')
                        .select('*', { count: 'exact', head: true })
                        .eq('trainingRecordId', record.trainingRecordId)
                        .eq('status', 'Completed');

                    if (totalError || completedError) {
                        console.error('Error counting activities:', totalError || completedError);
                    }

                    // Calculate training percentage
                    const percentage = totalActivities > 0 ? 
                        Math.round((completedActivities / totalActivities) * 100) : 0;

                    return {
                        ...record,
                        trainingName: record.trainings.trainingName,
                        trainingDesc: record.trainings.trainingDesc,
                        isOnlineArrangement: record.trainings.isOnlineArrangement,
                        totalDuration: record.trainings.totalDuration,
                        totalActivities: totalActivities || 0,
                        completedActivities: completedActivities || 0,
                        trainingPercentage: percentage
                    };
                } catch (error) {
                    console.error('Error processing training progress:', error);
                    return {
                        ...record,
                        trainingName: record.trainings?.trainingName || 'Unknown Training',
                        trainingDesc: record.trainings?.trainingDesc || '',
                        isOnlineArrangement: record.trainings?.isOnlineArrangement || false,
                        totalDuration: record.trainings?.totalDuration || 0,
                        totalActivities: 0,
                        completedActivities: 0,
                        trainingPercentage: 0
                    };
                }
            })
        );
        
        res.json({
            success: true,
            data: enrichedRecords
        });
    } catch (error) {
        console.error('Error fetching training progress:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch training progress',
            error: error.message 
        });
    }
        }, 

getTrainingsByJobAndDept: async function(req, res) {
    console.log(`[${new Date().toISOString()}] Fetching trainings for modal dropdown - user ${req.session?.user?.userId}`);
    
    try {
        const userId = req.session?.user?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // Get user's job and department from staffaccounts
        const { data: staff, error: staffError } = await supabase
            .from('staffaccounts')
            .select('jobId, departmentId')
            .eq('userId', userId)
            .single();

        if (staffError || !staff) {
            console.error('Error fetching staff details:', staffError);
            return res.status(404).json({
                success: false,
                message: 'Staff information not found'
            });
        }

        // Get trainings for user's job
        const { data: trainings, error: trainingsError } = await supabase
            .from('trainings')
            .select('trainingId, trainingName, trainingDesc, isOnlineArrangement, cost, totalDuration, address, country')
            .eq('jobId', staff.jobId)
            .eq('isActive', true)
            .order('trainingName', { ascending: true });

        if (trainingsError) {
            console.error('Error fetching trainings:', trainingsError);
            throw new Error(`Failed to fetch trainings: ${trainingsError.message}`);
        }

        console.log(`Found ${trainings?.length || 0} trainings for user's job`);

        res.json({
            success: true,
            data: trainings || [],
            count: trainings?.length || 0
        });

    } catch (error) {
        console.error('Error in getTrainingsByJobAndDept:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch trainings',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},


// Enhanced function to get training activities, skills and objectives
getTrainingSkillsAndObjectives: async function(req, res) {
    console.log(`[${new Date().toISOString()}] Fetching details for training ${req.params.trainingId}`);

    try {
        const { trainingId } = req.params;

        if (!trainingId) {
            return res.status(400).json({
                success: false,
                message: 'Training ID is required'
            });
        }

        // Get training activities with types
        const { data: activities, error: activitiesError } = await supabase
            .from('training_activities')
            .select(`
                activityId,
                activityName,
                activityType,
                estActivityDuration,
                activityRemarks
            `)
            .eq('trainingId', parseInt(trainingId))
            .order('activityId', { ascending: true });

        if (activitiesError) {
            console.error('Error fetching training activities:', activitiesError);
        }

        // Get training skills
        const { data: trainingSkills, error: skillsError } = await supabase
            .from('training_skills')
            .select('jobReqSkillId')
            .eq('trainingId', parseInt(trainingId));

        if (skillsError) {
            console.error('Error fetching training skills:', skillsError);
        }

        // Get skill details if any skills exist
        let skills = [];
        if (trainingSkills && trainingSkills.length > 0) {
            const skillIds = trainingSkills.map(ts => ts.jobReqSkillId);
            const { data: skillDetails, error: skillDetailsError } = await supabase
                .from('jobreqskills')
                .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
                .in('jobReqSkillId', skillIds)
                .order('jobReqSkillName', { ascending: true });

            if (!skillDetailsError && skillDetails) {
                skills = skillDetails;
            }
        }

        // Get training objectives
        const { data: trainingObjectives, error: objectivesError } = await supabase
            .from('training_objectives')
            .select('objectiveId')
            .eq('trainingId', parseInt(trainingId));

        if (objectivesError) {
            console.error('Error fetching training objectives:', objectivesError);
        }

        // Get objective details if any objectives exist
        let objectives = [];
        if (trainingObjectives && trainingObjectives.length > 0) {
            const objectiveIds = trainingObjectives.map(to => to.objectiveId);
            const { data: objectiveDetails, error: objectiveDetailsError } = await supabase
                .from('objectivesettings_objectives')
                .select('objectiveId, objectiveDescrpt, objectiveKPI, objectiveUOM')
                .in('objectiveId', objectiveIds)
                .order('objectiveDescrpt', { ascending: true });

            if (!objectiveDetailsError && objectiveDetails) {
                objectives = objectiveDetails;
            }
        }

        console.log(`Found ${activities?.length || 0} activities, ${skills.length} skills and ${objectives.length} objectives for training ${trainingId}`);

        res.json({
            success: true,
            data: {
                activities: activities || [],
                skills: skills,
                objectives: objectives
            }
        });

    } catch (error) {
        console.error('Error in getTrainingSkillsAndObjectives:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch training details',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

// Enhanced create training request with activity-based scheduling
createTrainingRequest: async function(req, res) {
    console.log(`[${new Date().toISOString()}] Creating enhanced training request for user ${req.session?.user?.userId}`);
    console.log('Request body:', req.body);

    try {
        const userId = req.session?.user?.userId;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        const { trainingId, startDate, endDate, scheduleType } = req.body;

        // Validate required fields
        if (!trainingId || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Training ID, start date, and end date are required'
            });
        }

        // Validate dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (end <= start) {
            return res.status(400).json({
                success: false,
                message: 'End date must be after start date'
            });
        }

        // Check if training exists and is active
        const { data: training, error: trainingError } = await supabase
            .from('trainings')
            .select('trainingId, trainingName, isOnlineArrangement, totalDuration')
            .eq('trainingId', parseInt(trainingId))
            .eq('isActive', true)
            .single();

        if (trainingError || !training) {
            console.error('Training not found or inactive:', trainingError);
            return res.status(404).json({
                success: false,
                message: 'Training not found or inactive'
            });
        }

        // Check for existing active requests for the same training
        const { data: existingRequests, error: existingError } = await supabase
            .from('training_records')
            .select('trainingRecordId, setStartDate, setEndDate, trainingStatus')
            .eq('userId', userId)
            .eq('trainingId', parseInt(trainingId))
            .in('trainingStatus', ['Not Started', 'In Progress', 'Pending Approval']);

        if (existingError && existingError.code !== 'PGRST116') {
            console.error('Error checking existing requests:', existingError);
            throw new Error(`Failed to check existing requests: ${existingError.message}`);
        }

        // Check for overlapping dates
        if (existingRequests && existingRequests.length > 0) {
            const hasOverlap = existingRequests.some(request => {
                const requestStart = new Date(request.setStartDate);
                const requestEnd = new Date(request.setEndDate);
                
                return (start <= requestEnd && end >= requestStart);
            });

            if (hasOverlap) {
                const overlapping = existingRequests[0];
                return res.status(400).json({
                    success: false,
                    message: `You already have an active training request for this course (${overlapping.setStartDate} to ${overlapping.setEndDate}). Please choose different dates.`
                });
            }
        }

        // Create training record with schedule type information
        const trainingRecordData = {
            userId: userId,
            trainingId: parseInt(trainingId),
            setStartDate: startDate,
            setEndDate: endDate,
            trainingStatus: training.isOnlineArrangement && scheduleType === 'asynchronous' ? 'In Progress' : 'Not Started',
            isApproved: null,
            dateRequested: new Date().toISOString().split('T')[0],
            decisionRemarks: scheduleType ? `Schedule Type: ${scheduleType}` : null
        };

        console.log('Creating training record with data:', trainingRecordData);

        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .insert([trainingRecordData])
            .select()
            .single();

        if (recordError) {
            console.error('Error creating training record:', recordError);
            throw new Error(`Failed to create training record: ${recordError.message}`);
        }

        const trainingRecordId = trainingRecord.trainingRecordId;
        console.log(`Training record created with ID: ${trainingRecordId}`);

        // Get training activities
        console.log(`Fetching activities for training ID: ${trainingId}`);
        const { data: activities, error: activitiesError } = await supabase
            .from('training_activities')
            .select('activityId, activityName, estActivityDuration, activityType')
            .eq('trainingId', parseInt(trainingId))
            .order('activityId', { ascending: true });

        let activitiesCreated = 0;
        let activitiesFailed = 0;
        
        if (activitiesError) {
            console.error('Error fetching training activities:', activitiesError);
            console.log('Continuing without activities...');
        } else if (activities && activities.length > 0) {
            console.log(`Found ${activities.length} activities for training:`, activities);
            
            // Create activity records with enhanced status for async trainings
            for (const activity of activities) {
                try {
                    const activityRecordData = {
                        trainingRecordId: trainingRecordId,
                        activityId: activity.activityId,
                        status: training.isOnlineArrangement && scheduleType === 'asynchronous' ? 'Available' : 'Not Started',
                        timestampzStarted: null,
                        timestampzCompleted: null
                    };

                    console.log('Creating activity record:', activityRecordData);

                    const { data: activityRecord, error: activityInsertError } = await supabase
                        .from('training_records_activities')
                        .insert([activityRecordData])
                        .select()
                        .single();

                    if (activityInsertError) {
                        console.error(`Error creating activity record for activity ${activity.activityId}:`, activityInsertError);
                        activitiesFailed++;
                    } else {
                        activitiesCreated++;
                        console.log(`Successfully created activity record: ${activityRecord.trainingRecordActivityId} for activity ${activity.activityId}`);
                    }
                } catch (activityError) {
                    console.error(`Exception creating activity record for activity ${activity.activityId}:`, activityError);
                    activitiesFailed++;
                }
            }
            
            console.log(`Activity creation summary:`);
            console.log(`- Total activities found: ${activities.length}`);
            console.log(`- Activities successfully created: ${activitiesCreated}`);
            console.log(`- Activities failed to create: ${activitiesFailed}`);
        } else {
            console.log('No activities found for this training');
        }

        // Get training certifications and create certificate records
        console.log(`Fetching certifications for training ID: ${trainingId}`);
        const { data: certifications, error: certificationsError } = await supabase
            .from('training_certifications')
            .select('trainingCertId, trainingCertTitle')
            .eq('trainingId', parseInt(trainingId));

        let certificatesCreated = 0;
        let certificatesFailed = 0;

        if (certificationsError) {
            console.error('Error fetching training certifications:', certificationsError);
            console.log('Continuing without certifications...');
        } else if (certifications && certifications.length > 0) {
            console.log(`Found ${certifications.length} certifications for training`);

            // Create certificate records
            for (const cert of certifications) {
                try {
                    const certificateRecordData = {
                        trainingRecordId: trainingRecordId,
                        trainingCertId: cert.trainingCertId,
                        certificate_url: null // Initially null, to be updated when certificate is issued
                    };

                    console.log('Creating certificate record:', certificateRecordData);

                    const { data: certificateRecord, error: certInsertError } = await supabase
                        .from('training_records_certificates')
                        .insert([certificateRecordData])
                        .select()
                        .single();

                    if (certInsertError) {
                        console.error(`Error creating certificate record for certification ${cert.trainingCertId}:`, certInsertError);
                        certificatesFailed++;
                    } else {
                        certificatesCreated++;
                        console.log(`Successfully created certificate record: ${certificateRecord.trainingRecordCertificateId}`);
                    }
                } catch (certError) {
                    console.error(`Exception creating certificate record for certification ${cert.trainingCertId}:`, certError);
                    certificatesFailed++;
                }
            }

            console.log(`Certificate creation summary:`);
            console.log(`- Total certifications found: ${certifications.length}`);
            console.log(`- Certificates successfully created: ${certificatesCreated}`);
            console.log(`- Certificates failed to create: ${certificatesFailed}`);
        } else {
            console.log('No certifications found for this training');
        }

        console.log(`Enhanced training request created successfully: ${trainingRecordId} with ${activitiesCreated}/${activities ? activities.length : 0} activities and ${certificatesCreated}/${certifications ? certifications.length : 0} certificates`);

        res.status(201).json({
            success: true,
            message: 'Training request submitted successfully',
            data: {
                trainingRecordId: trainingRecordId,
                trainingName: training.trainingName,
                status: trainingRecordData.trainingStatus,
                isApproved: null,
                scheduleType: scheduleType,
                isOnline: training.isOnlineArrangement,
                activitiesCreated: activitiesCreated,
                totalActivitiesAvailable: activities ? activities.length : 0,
                activitiesFailed: activitiesFailed,
                allActivitiesCreated: activitiesCreated === (activities ? activities.length : 0),
                certificatesCreated: certificatesCreated,
                totalCertificatesAvailable: certifications ? certifications.length : 0,
                certificatesFailed: certificatesFailed,
                allCertificatesCreated: certificatesCreated === (certifications ? certifications.length : 0)
            }
        });

    } catch (error) {
        console.error('Error in enhanced createTrainingRequest:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create training request',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
getTrainingProgress: async function(req, res) {
    const userId = req.session?.user?.userId;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    console.log(`[${new Date().toISOString()}] Fetching training progress for user ${userId}`);
    
    try {
        // Get all training records for the user (including all approval states)
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                trainingId,
                setStartDate,
                setEndDate,
                trainingStatus,
                isApproved,
                dateRequested,
                trainings (
                    trainingName,
                    trainingDesc,
                    isOnlineArrangement,
                    totalDuration,
                    cost,
                    address
                )
            `)
            .eq('userId', userId)
            .order('dateRequested', { ascending: false });

        if (recordsError) {
            console.error('Error fetching training records:', recordsError);
            throw new Error(`Failed to fetch training records: ${recordsError.message}`);
        }

        console.log(`Found ${trainingRecords?.length || 0} training records for user ${userId}`);

        if (!trainingRecords || trainingRecords.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }

        // Process each training record
        const trainingProgressPromises = trainingRecords.map(async (record) => {
            try {
                // Get all activities for this training
                const { data: trainingActivities, error: activitiesError } = await supabase
                    .from('training_activities')
                    .select('activityId, activityName, estActivityDuration')
                    .eq('trainingId', record.trainingId);

                if (activitiesError) {
                    console.error(`Error fetching activities for training ${record.trainingId}:`, activitiesError);
                }

                // Get activity records for this specific training record
                const { data: recordActivities, error: recordActivitiesError } = await supabase
                    .from('training_records_activities')
                    .select(`
                        activityId, 
                        status, 
                        timestampzStarted,
                        timestampzCompleted,
                        created_at
                    `)
                    .eq('trainingRecordId', record.trainingRecordId);

                if (recordActivitiesError) {
                    console.error(`Error fetching record activities for record ${record.trainingRecordId}:`, recordActivitiesError);
                }

                // Get certificates for this training record
                const { data: recordCertificates, error: certificatesError } = await supabase
                    .from('training_records_certificates')
                    .select(`
                        trainingRecordCertificateId,
                        certificate_url,
                        created_at,
                        trainingCertId,
                        training_certifications (
                            trainingCertTitle,
                            trainingCertDesc
                        )
                    `)
                    .eq('trainingRecordId', record.trainingRecordId);

                if (certificatesError) {
                    console.error(`Error fetching certificates for record ${record.trainingRecordId}:`, certificatesError);
                }

                // Calculate progress
                const totalActivities = trainingActivities?.length || 0;
                const completedActivities = recordActivities?.filter(ra => ra.status === 'Completed')?.length || 0;
                const inProgressActivities = recordActivities?.filter(ra => ra.status === 'In Progress')?.length || 0;

                let progressPercentage = 0;
                if (totalActivities > 0) {
                    progressPercentage = Math.round((completedActivities / totalActivities) * 100);
                }

                // Enhanced status determination with approval states
                let status = 'Not Started';
                const today = new Date();
                const endDate = record.setEndDate ? new Date(record.setEndDate) : null;

                // Check approval status first
                if (record.isApproved === null) {
                    status = 'Awaiting Approval';
                } else if (record.isApproved === false) {
                    status = 'Rejected';
                } else if (record.isApproved === true) {
                    // Only check progress for approved trainings
                    if (completedActivities === totalActivities && totalActivities > 0) {
                        status = 'Completed';
                    } else if (endDate && today > endDate && progressPercentage < 100) {
                        status = 'Overdue';
                    } else if (inProgressActivities > 0 || completedActivities > 0) {
                        status = 'In Progress';
                    } else {
                        status = 'Not Started';
                    }
                }

                // Format certificates
                const certificates = recordCertificates?.map(cert => ({
                    certificateId: cert.trainingRecordCertificateId,
                    certificateUrl: cert.certificate_url,
                    issuedDate: cert.created_at,
                    title: cert.training_certifications?.trainingCertTitle,
                    description: cert.training_certifications?.trainingCertDesc
                })) || [];

                // Format activities with their completion status
                const activitiesWithStatus = trainingActivities?.map(activity => {
                    const recordActivity = recordActivities?.find(ra => ra.activityId === activity.activityId);
                    return {
                        activityId: activity.activityId,
                        activityName: activity.activityName,
                        estimatedDuration: activity.estActivityDuration,
                        status: recordActivity?.status || 'Not Started',
                        startedAt: recordActivity?.timestampzStarted || null,
                        completedAt: recordActivity?.timestampzCompleted || null
                    };
                }) || [];

                return {
                    trainingRecordId: record.trainingRecordId,
                    trainingId: record.trainingId,
                    trainingName: record.trainings?.trainingName,
                    trainingDesc: record.trainings?.trainingDesc,
                    isOnlineArrangement: record.trainings?.isOnlineArrangement,
                    totalDuration: record.trainings?.totalDuration,
                    cost: record.trainings?.cost,
                    address: record.trainings?.address,
                    setStartDate: record.setStartDate,
                    setEndDate: record.setEndDate,
                    trainingStatus: record.trainingStatus,
                    isApproved: record.isApproved,
                    dateRequested: record.dateRequested,
                    trainingPercentage: progressPercentage,
                    totalActivities,
                    completedActivities,
                    inProgressActivities,
                    status: status,
                    activities: activitiesWithStatus,
                    certificates: certificates
                };
            } catch (error) {
                console.error(`Error processing training record ${record.trainingRecordId}:`, error);
                // Return minimal data for failed records
                return {
                    trainingRecordId: record.trainingRecordId,
                    trainingId: record.trainingId,
                    trainingName: record.trainings?.trainingName || 'Unknown Training',
                    trainingPercentage: 0,
                    totalActivities: 0,
                    completedActivities: 0,
                    status: 'Error',
                    activities: [],
                    certificates: [],
                    error: error.message
                };
            }
        });

        const trainingsWithProgress = await Promise.all(trainingProgressPromises);

        console.log(`Processed ${trainingsWithProgress.length} training records`);

        res.json({
            success: true,
            data: trainingsWithProgress
        });

    } catch (error) {
        console.error('Error in getTrainingProgress:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch training progress',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

// Helper function to get detailed training record with all related data
getTrainingRecordDetails: async function(req, res) {
    const userId = req.session?.user?.userId;
    const { trainingRecordId } = req.params;
    
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    try {
        // Get the training record with full details
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select(`
                *,
                trainings (
                    *,
                    training_activities (
                        activityId,
                        activityName,
                        estActivityDuration,
                        activityRemarks,
                        activityType
                    )
                )
            `)
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError) throw recordError;
        if (!trainingRecord) {
            return res.status(404).json({
                success: false,
                message: 'Training record not found'
            });
        }

        // Get activity progress
        const { data: activityProgress, error: progressError } = await supabase
            .from('training_records_activities')
            .select('*')
            .eq('trainingRecordId', trainingRecordId);

        if (progressError) throw progressError;

        // Get certificates
        const { data: certificates, error: certError } = await supabase
            .from('training_records_certificates')
            .select(`
                *,
                training_certifications (
                    trainingCertTitle,
                    trainingCertDesc
                )
            `)
            .eq('trainingRecordId', trainingRecordId);

        if (certError) throw certError;

        // Combine the data
        const result = {
            ...trainingRecord,
            activityProgress: activityProgress || [],
            certificates: certificates || []
        };

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error fetching training record details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch training record details',
            error: error.message
        });
    }
},

// Enhanced getAllCourses with approval status indicators
getAllCourses: async function(req, res) {
    const userId = req.session?.user?.userId;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    console.log(`[${new Date().toISOString()}] Fetching all courses for user ${userId}`);
    
    try {
        // Get user's training records with full training details
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                trainingId,
                setStartDate,
                setEndDate,
                trainingStatus,
                isApproved,
                dateRequested,
                trainings (
                    trainingName,
                    trainingDesc,
                    isOnlineArrangement,
                    totalDuration,
                    cost,
                    address,
                    isActive
                )
            `)
            .eq('userId', userId)
            .order('dateRequested', { ascending: false });

        if (recordsError) {
            console.error('Error fetching training records:', recordsError);
            throw recordsError;
        }

        console.log(`Found ${trainingRecords?.length || 0} training records for user ${userId}`);

        if (!trainingRecords || trainingRecords.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }

        // Process each record to add progress information and approval status
        const coursesWithProgress = await Promise.all(
            trainingRecords.map(async (record) => {
                try {
                    // Get activities count
                    const { data: activities, error: activitiesError } = await supabase
                        .from('training_activities')
                        .select('activityId')
                        .eq('trainingId', record.trainingId);

                    if (activitiesError) {
                        console.error(`Error fetching activities for training ${record.trainingId}:`, activitiesError);
                    }

                    // Get completed activities
                    const { data: completedActivities, error: completedError } = await supabase
                        .from('training_records_activities')
                        .select('activityId')
                        .eq('trainingRecordId', record.trainingRecordId)
                        .eq('status', 'Completed');

                    if (completedError) {
                        console.error(`Error fetching completed activities for record ${record.trainingRecordId}:`, completedError);
                    }

                    const totalActivities = activities?.length || 0;
                    const completedCount = completedActivities?.length || 0;
                    const trainingPercentage = totalActivities > 0 ? Math.round((completedCount / totalActivities) * 100) : 0;

                    // Enhanced status determination for courses
                    let status = 'Not Started';
                    if (record.isApproved === null) {
                        status = 'Awaiting Approval';
                    } else if (record.isApproved === false) {
                        status = 'Rejected';
                    } else if (record.isApproved === true) {
                        if (trainingPercentage === 100) {
                            status = 'Completed';
                        } else if (trainingPercentage > 0) {
                            status = 'In Progress';
                        } else {
                            status = 'Not Started';
                        }
                    }

                    return {
                        ...record,
                        ...record.trainings, // Flatten training details
                        totalActivities,
                        completedActivities: completedCount,
                        trainingPercentage,
                        status // Add computed status
                    };
                } catch (error) {
                    console.error(`Error processing course record ${record.trainingRecordId}:`, error);
                    return {
                        ...record,
                        ...record.trainings,
                        totalActivities: 0,
                        completedActivities: 0,
                        trainingPercentage: 0,
                        status: 'Error',
                        error: error.message
                    };
                }
            })
        );

        res.json({
            success: true,
            data: coursesWithProgress
        });

    } catch (error) {
        console.error('Error in getAllCourses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch courses',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
// Get Certificates - Updated to fetch from training_records_certificates
// Get Certificates - Simplified approach
getEmployeeCertificates: async function(req, res) {
    const userId = req.session?.user?.userId;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    console.log(`[${new Date().toISOString()}] Fetching certificates for user ${userId}`);
    
    try {
        // Step 1: Get user's training records
        const { data: userTrainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select('trainingRecordId, trainingId')
            .eq('userId', userId)
            .eq('isApproved', true);

        if (recordsError) {
            console.error('Error fetching training records:', recordsError);
            throw new Error(`Failed to fetch training records: ${recordsError.message}`);
        }

        if (!userTrainingRecords || userTrainingRecords.length === 0) {
            console.log(`No training records found for user ${userId}`);
            return res.json({
                success: true,
                data: [],
                count: 0
            });
        }

        const trainingRecordIds = userTrainingRecords.map(r => r.trainingRecordId);
        console.log('Training record IDs:', trainingRecordIds);

        // Step 2: Get certificate records for these training records
        const { data: certificateRecords, error: certError } = await supabase
            .from('training_records_certificates')
            .select('*')
            .in('trainingRecordId', trainingRecordIds)
            .not('certificate_url', 'is', null)
            .neq('certificate_url', '')
            .order('created_at', { ascending: false });

        if (certError) {
            console.error('Error fetching certificate records:', certError);
            throw new Error(`Failed to fetch certificate records: ${certError.message}`);
        }

        console.log('Certificate records found:', certificateRecords?.length || 0);

        if (!certificateRecords || certificateRecords.length === 0) {
            return res.json({
                success: true,
                data: [],
                count: 0
            });
        }

        // Step 3: Get training names for context
        const trainingIds = [...new Set(userTrainingRecords.map(r => r.trainingId))];
        const { data: trainings, error: trainingsError } = await supabase
            .from('trainings')
            .select('trainingId, trainingName')
            .in('trainingId', trainingIds);

        if (trainingsError) {
            console.error('Error fetching trainings:', trainingsError);
        }

        // Step 4: Get certificate details if trainingCertId exists
        const certIds = certificateRecords
            .filter(cert => cert.trainingCertId)
            .map(cert => cert.trainingCertId);

        let certificateDetails = [];
        if (certIds.length > 0) {
            const { data: certDetails, error: certDetailsError } = await supabase
                .from('training_certifications')
                .select('trainingCertId, trainingCertTitle, trainingCertDesc')
                .in('trainingCertId', certIds);

            if (!certDetailsError) {
                certificateDetails = certDetails || [];
            }
        }

        // Step 5: Format the response
        const formattedCertificates = certificateRecords.map(cert => {
            // Find the training record to get training info
            const trainingRecord = userTrainingRecords.find(tr => tr.trainingRecordId === cert.trainingRecordId);
            const training = trainings?.find(t => t.trainingId === trainingRecord?.trainingId);
            const certDetail = certificateDetails.find(cd => cd.trainingCertId === cert.trainingCertId);

            return {
                trainingRecordCertificateId: cert.trainingRecordCertificateId,
                certificate_url: cert.certificate_url,
                created_at: cert.created_at,
                trainingRecordId: cert.trainingRecordId,
                trainingName: training?.trainingName || 'Unknown Training',
                trainingCertTitle: certDetail?.trainingCertTitle || training?.trainingName || 'Training Certificate',
                trainingCertDesc: certDetail?.trainingCertDesc || 'Certificate of completion'
            };
        });

        console.log(`Returning ${formattedCertificates.length} certificates for user ${userId}`);

        res.json({
            success: true,
            data: formattedCertificates,
            count: formattedCertificates.length
        });

    } catch (error) {
        console.error('Error in getEmployeeCertificates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch certificates',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
uploadTrainingCertificate: async function(req, res) {
    console.log('📂 [Certificate Upload] Initiating certificate upload process...');
    console.log('📂 [Certificate Upload] Request body:', req.body);
    console.log('📂 [Certificate Upload] Request files:', req.files ? Object.keys(req.files) : 'No files');

    try {
        // Use the same session pattern as handleFileUpload
        const userId = req.session?.user?.userId || req.session?.userID;
        console.log('📂 [Certificate Upload] User ID from session:', userId);
        
        if (!userId) {
            console.error('❌ [Certificate Upload] User not authenticated.');
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        if (!req.files || !req.files.file) {
            console.log('❌ [Certificate Upload] No file uploaded.');
            return res.status(400).json({ 
                success: false, 
                message: 'No file uploaded.' 
            });
        }

        const file = req.files.file;
        const trainingRecordId = req.body.trainingRecordId;
        const trainingCertId = req.body.trainingCertId;

        console.log('📂 [Certificate Upload] File data:', {
            trainingRecordId,
            trainingCertId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.mimetype
        });

        if (!trainingRecordId || !trainingCertId) {
            console.error('❌ [Certificate Upload] Missing required parameters');
            return res.status(400).json({ 
                success: false, 
                message: 'Training record ID and certificate ID are required.' 
            });
        }

        // File validation - same as handleFileUpload but with higher limit for certificates
        const allowedTypes = [
            'application/pdf', 'image/jpeg', 'image/png', 'image/jpg',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const maxSize = 10 * 1024 * 1024; // 10 MB for certificates (vs 5MB in handleFileUpload)

        if (!allowedTypes.includes(file.mimetype)) {
            console.log('❌ [Certificate Upload] Invalid file type:', file.mimetype);
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid file type. Please upload PDF, image, or Word document.' 
            });
        }

        if (file.size > maxSize) {
            console.log('❌ [Certificate Upload] File size exceeds limit:', file.size);
            return res.status(400).json({ 
                success: false, 
                message: 'File size exceeds the 10 MB limit.' 
            });
        }

        // Verify training record belongs to user
        console.log('🔍 [Certificate Upload] Verifying training record...');
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select('trainingRecordId, trainingId')
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError || !trainingRecord) {
            console.error('❌ [Certificate Upload] Training record not found:', recordError);
            return res.status(404).json({ 
                success: false, 
                message: 'Training record not found or access denied.' 
            });
        }

        // Verify certificate exists for this training
        console.log('🔍 [Certificate Upload] Verifying certificate configuration...');
        const { data: certificationExists, error: certError } = await supabase
            .from('training_certifications')
            .select('trainingCertId, trainingCertTitle, trainingCertDesc')
            .eq('trainingCertId', trainingCertId)
            .eq('trainingId', trainingRecord.trainingId)
            .single();

        if (certError || !certificationExists) {
            console.error('❌ [Certificate Upload] Certificate not found for this training:', certError);
            return res.status(404).json({ 
                success: false, 
                message: 'Certificate not found for this training.' 
            });
        }

        // Check if all activities are completed
        console.log('🔍 [Certificate Upload] Checking activity completion...');
        const { data: activities, error: activitiesError } = await supabase
            .from('training_records_activities')
            .select(`
                activityId, 
                status,
                training_activities!inner(
                    activityName,
                    estActivityDuration
                )
            `)
            .eq('trainingRecordId', trainingRecordId);

        if (activitiesError) {
            console.error('❌ [Certificate Upload] Error checking activities:', activitiesError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error checking training completion status.',
                error: activitiesError.message,
                timestamp: new Date().toISOString()
            });
        }

        // Use robust completion check (assuming you have this function)
        const completionResult = checkActivitiesCompletion(activities);
        console.log('📊 [Certificate Upload] Completion analysis:', completionResult);

        if (!completionResult.completed) {
            console.log('❌ [Certificate Upload] Not all activities completed.');
            return res.status(400).json({ 
                success: false, 
                message: `Please complete all training activities before uploading certificates. ${completionResult.incomplete} of ${completionResult.total} activities are incomplete.`,
                debug: {
                    reason: completionResult.reason,
                    totalActivities: completionResult.total,
                    incompleteCount: completionResult.incomplete,
                    incompleteActivities: completionResult.incompleteList
                }
            });
        }

        // Sanitize filename - same as your pattern but more robust
        function sanitizeFilename(filename) {
            let sanitized = filename
                .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(/[^\w\s.-]/g, '')
                .trim()
                .replace(/\s/g, '_');
            
            console.log('📂 [Certificate Upload] Filename sanitization:', {
                original: filename,
                sanitized: sanitized
            });
            
            return sanitized;
        }

        // Generate unique file name - same pattern as handleFileUpload
        const sanitizedFileName = sanitizeFilename(file.name);
        const uniqueName = `${Date.now()}-${sanitizedFileName}`;
        const filePath = path.join(__dirname, '../uploads', uniqueName);

        console.log(`📎 [Certificate Upload] File processed: ${uniqueName} (Type: ${file.mimetype}, Size: ${file.size} bytes)`);

        // Create uploads directory if it doesn't exist - same as handleFileUpload
        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        // Save file locally first - same as handleFileUpload
        await file.mv(filePath);
        console.log('📂 [Certificate Upload] File successfully saved locally. Uploading to Supabase...');

        // Upload to Supabase using the same pattern - SAME uploads bucket as handleFileUpload
        const { error: uploadError } = await supabase.storage
            .from('uploads')
            .upload(uniqueName, fs.readFileSync(filePath), {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: false,
            });

        // Remove local file after upload - same as handleFileUpload
        fs.unlinkSync(filePath);
        console.log('📂 [Certificate Upload] Local file deleted after upload to Supabase.');

        if (uploadError) {
            console.error('❌ [Certificate Upload] Error uploading file to Supabase:', uploadError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error uploading file to storage. Please try again.',
                error: uploadError.message,
                timestamp: new Date().toISOString()
            });
        }

        // Generate file URL - SAME uploads bucket as handleFileUpload
        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${uniqueName}`;
        console.log(`✅ [Certificate Upload] File uploaded successfully: ${fileUrl}`);

        // Insert file metadata into user_files - SAME AS handleFileUpload
        console.log('📂 [Certificate Upload] Inserting file metadata into user_files...');
        const { error: insertError } = await supabase
            .from('user_files')
            .insert([{
                userId: userId,
                file_name: uniqueName,
                file_url: fileUrl,
                uploaded_at: new Date(),
                file_size: file.size,
            }]);

        if (insertError) {
            console.error('❌ [Certificate Upload] Error inserting file metadata:', insertError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error inserting file metadata into database.',
                error: insertError.message,
                timestamp: new Date().toISOString()
            });
        }

        console.log('✅ [Certificate Upload] File metadata successfully inserted into user_files database.');

        // NOW save the certificate record - this is the additional step for certificates
        console.log('💾 [Certificate Upload] Saving certificate record to training_records_certificates...');
        const certificateData = {
            trainingRecordId: parseInt(trainingRecordId),
            trainingCertId: parseInt(trainingCertId),
            certificate_url: fileUrl,
            created_at: new Date().toISOString()
        };

        console.log('💾 [Certificate Upload] Certificate data to save:', certificateData);

        // Check if certificate record already exists
        console.log('🔍 [Certificate Upload] Checking for existing certificate record...');
        const { data: existingCert, error: existingError } = await supabase
            .from('training_records_certificates')
            .select('trainingRecordCertificateId, certificate_url')
            .eq('trainingRecordId', trainingRecordId)
            .eq('trainingCertId', trainingCertId)
            .maybeSingle();

        console.log('🔍 [Certificate Upload] Existing certificate check:', { data: existingCert, error: existingError });

        if (existingError && existingError.code !== 'PGRST116') {
            console.error('❌ [Certificate Upload] Error checking existing certificate:', existingError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error checking existing certificate record.',
                error: existingError.message,
                timestamp: new Date().toISOString()
            });
        }

        let savedCertificate;
        if (existingCert) {
            // Update existing record
            console.log('🔄 [Certificate Upload] Updating existing certificate record...');
            const { data: updatedCert, error: updateError } = await supabase
                .from('training_records_certificates')
                .update({
                    certificate_url: fileUrl,
                    created_at: certificateData.created_at
                })
                .eq('trainingRecordCertificateId', existingCert.trainingRecordCertificateId)
                .select()
                .single();

            if (updateError) {
                console.error('❌ [Certificate Upload] Error updating certificate record:', updateError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'File uploaded to user_files but failed to update certificate record.',
                    error: updateError.message,
                    timestamp: new Date().toISOString()
                });
            }
            savedCertificate = updatedCert;
            console.log('✅ [Certificate Upload] Certificate record updated successfully:', savedCertificate);
        } else {
            // Insert new record
            console.log('➕ [Certificate Upload] Inserting new certificate record...');
            const { data: insertedCert, error: insertError } = await supabase
                .from('training_records_certificates')
                .insert([certificateData])
                .select()
                .single();

            if (insertError) {
                console.error('❌ [Certificate Upload] Error inserting certificate record:', insertError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'File uploaded to user_files but failed to save certificate record.',
                    error: insertError.message,
                    timestamp: new Date().toISOString()
                });
            }
            savedCertificate = insertedCert;
            console.log('✅ [Certificate Upload] New certificate record inserted successfully:', savedCertificate);
        }

        // Verify the certificate_url was actually saved
        if (!savedCertificate || !savedCertificate.certificate_url) {
            console.error('❌ [Certificate Upload] Certificate saved but URL is null:', savedCertificate);
            return res.status(500).json({ 
                success: false, 
                message: 'Certificate record saved but file URL is missing. Please try uploading again.',
                debug: savedCertificate,
                timestamp: new Date().toISOString()
            });
        }

        // FINAL VERIFICATION: Double-check the record was saved correctly
        console.log('🔍 [Certificate Upload] Final verification...');
        const { data: verificationData, error: verificationError } = await supabase
            .from('training_records_certificates')
            .select('trainingRecordCertificateId, certificate_url, created_at')
            .eq('trainingRecordId', trainingRecordId)
            .eq('trainingCertId', trainingCertId)
            .single();

        console.log('🔍 [Certificate Upload] Final verification result:', { 
            data: verificationData, 
            error: verificationError 
        });

        if (verificationError || !verificationData || !verificationData.certificate_url) {
            console.error('❌ [Certificate Upload] Final verification failed:', verificationError);
            return res.status(500).json({ 
                success: false, 
                message: 'Certificate upload verification failed. The file may not have been saved properly.',
                timestamp: new Date().toISOString()
            });
        }

        // SUCCESS: Return the same response pattern as your other functions
        console.log('✅ [Certificate Upload] Upload process completed and verified successfully');
        res.json({
            success: true,
            message: `Certificate "${certificationExists.trainingCertTitle}" uploaded and verified successfully`,
            data: {
                certificateUrl: verificationData.certificate_url,
                certificateId: verificationData.trainingRecordCertificateId,
                trainingCertTitle: certificationExists.trainingCertTitle,
                trainingCertDesc: certificationExists.trainingCertDesc,
                uploadedAt: verificationData.created_at,
                fileName: uniqueName
            }
        });

    } catch (error) {
        console.error('❌ [Certificate Upload] Unexpected error:', error);
        console.error('❌ [Certificate Upload] Error stack:', error.stack);
        return res.status(500).json({ 
            success: false, 
            message: 'An unexpected error occurred during certificate upload.',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
// ENHANCED: Get certificates with better null checking
getCertificatesForTraining: async function(req, res) {
    const userId = req.session?.user?.userId;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    const trainingRecordId = req.params.trainingRecordId;
    console.log(`[${new Date().toISOString()}] Fetching certificates for training record ${trainingRecordId} for user ${userId}`);

    try {
        if (!trainingRecordId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Training record ID is required.' 
            });
        }

        // Verify training record belongs to user
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select('trainingRecordId, trainingId')
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError || !trainingRecord) {
            return res.status(404).json({
                success: false,
                message: 'Training record not found or access denied'
            });
        }

        // Check if all activities are completed
        const { data: activities, error: activitiesError } = await supabase
            .from('training_records_activities')
            .select('activityId, status, activityName')
            .eq('trainingRecordId', trainingRecordId);

        let allCompleted = false;
        if (!activitiesError && activities) {
            console.log('📊 [Get Certificates] Raw activities:', activities);
            
            const completionResult = checkActivitiesCompletion(activities);
            allCompleted = completionResult.completed;
            
            console.log('📊 [Get Certificates] Completion analysis:', completionResult);
        }

        // Get all certificates assigned to this training
        const { data: trainingCertifications, error: certificationsError } = await supabase
            .from('training_certifications')
            .select('trainingCertId, trainingCertTitle, trainingCertDesc')
            .eq('trainingId', trainingRecord.trainingId)
            .order('trainingCertId', { ascending: true });

        if (certificationsError) {
            throw new Error(`Failed to fetch training certifications: ${certificationsError.message}`);
        }

        // Get uploaded certificates for this training record
        const { data: uploadedCertificates, error: uploadedError } = await supabase
            .from('training_records_certificates')
            .select('trainingCertId, certificate_url, created_at, trainingRecordCertificateId')
            .eq('trainingRecordId', trainingRecordId);

        if (uploadedError) {
            throw new Error(`Failed to fetch uploaded certificates: ${uploadedError.message}`);
        }

        // Combine certification requirements with upload status
        const certificatesWithStatus = (trainingCertifications || []).map(cert => {
            const uploaded = (uploadedCertificates || []).find(upload => 
                upload.trainingCertId === cert.trainingCertId && 
                upload.certificate_url !== null && 
                upload.certificate_url !== ''
            );
            
            return {
                trainingCertId: cert.trainingCertId,
                trainingCertTitle: cert.trainingCertTitle,
                trainingCertDesc: cert.trainingCertDesc,
                isUploaded: !!uploaded,
                certificate_url: uploaded?.certificate_url || null,
                uploadedAt: uploaded?.created_at || null,
                trainingRecordCertificateId: uploaded?.trainingRecordCertificateId || null,
                canUpload: allCompleted
            };
        });

        console.log('📊 [Get Certificates] Final certificates with status:', certificatesWithStatus);

        res.json({
            success: true,
            data: certificatesWithStatus,
            allActivitiesCompleted: allCompleted
        });

    } catch (error) {
        console.error('Error in getCertificatesForTraining:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch certificates for training',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

// UPDATED: Get training certificates function with consistent session handling
getTrainingCertificates: async function(req, res) {
    // FIXED: Use same session pattern as getAllCourses
    const userId = req.session?.user?.userId;
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    const trainingRecordId = req.params.trainingRecordId;
    
    console.log(`[${new Date().toISOString()}] Fetching certificates for training record ${trainingRecordId} for user ${userId}`);
    
    try {
        if (!trainingRecordId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Training record ID is required.' 
            });
        }

        // Verify training record belongs to user
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select('trainingRecordId, trainingId')
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError || !trainingRecord) {
            console.error('Training record not found:', recordError);
            return res.status(404).json({ 
                success: false, 
                message: 'Training record not found or access denied.' 
            });
        }

        // Get all certificates configured for this training
        const { data: trainingCertificates, error: certError } = await supabase
            .from('training_certifications')
            .select('trainingCertId, trainingCertTitle, trainingCertDesc')
            .eq('trainingId', trainingRecord.trainingId)
            .order('trainingCertId', { ascending: true });

        if (certError) {
            throw new Error(`Failed to fetch training certificates: ${certError.message}`);
        }

        // Get uploaded certificates for this training record
        const { data: uploadedCertificates, error: uploadError } = await supabase
            .from('training_records_certificates')
            .select('trainingCertId, certificate_url, created_at')
            .eq('trainingRecordId', trainingRecordId);

        if (uploadError) {
            throw new Error(`Failed to fetch uploaded certificates: ${uploadError.message}`);
        }

        // Combine certificate configurations with upload status
        const certificatesWithStatus = (trainingCertificates || []).map(cert => {
            const uploaded = (uploadedCertificates || []).find(up => up.trainingCertId === cert.trainingCertId);
            
            return {
                trainingCertId: cert.trainingCertId,
                trainingCertTitle: cert.trainingCertTitle,
                trainingCertDesc: cert.trainingCertDesc,
                isUploaded: !!uploaded,
                certificate_url: uploaded?.certificate_url || null,
                uploadedAt: uploaded?.created_at || null
            };
        });

        res.json({
            success: true,
            data: certificatesWithStatus
        });

    } catch (error) {
        console.error('Error in getTrainingCertificates:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch training certificates',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

// NEW: Get user's job information
getUserJobInfo: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const userId = req.session.user.userId;

        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('jobId, departmentId')
            .eq('userId', userId)
            .single();

        if (staffError || !staffData) {
            return res.status(404).json({
                success: false,
                message: 'Staff information not found'
            });
        }

        res.json({
            success: true,
            data: staffData
        });
    } catch (error) {
        console.error('Error fetching user job info:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user job information',
            error: error.message
        });
    }
},

// NEW: Get job skills
getJobSkills: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const { jobId } = req.params;

        const { data: skills, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', parseInt(jobId))
            .order('jobReqSkillName', { ascending: true });

        if (skillsError) {
            console.error('Error fetching job skills:', skillsError);
            throw skillsError;
        }

        res.json({
            success: true,
            data: skills || []
        });
    } catch (error) {
        console.error('Error in getJobSkills:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch job skills',
            error: error.message
        });
    }
},

// NEW: Get user objectives
getUserObjectives: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const userId = req.session.user.userId;

        // Get user's objective settings
        const { data: objectiveSettings, error: settingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId')
            .eq('userId', userId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (settingsError) {
            console.error('Error fetching objective settings:', settingsError);
            throw settingsError;
        }

        if (!objectiveSettings || objectiveSettings.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }

        // Get objectives for the latest settings
        const { data: objectives, error: objectivesError } = await supabase
            .from('objectivesettings_objectives')
            .select('objectiveId, objectiveDescrpt, objectiveKPI, objectiveUOM, objectiveTarget, objectiveAssignedWeight')
            .eq('objectiveSettingsId', objectiveSettings[0].objectiveSettingsId)
            .order('objectiveDescrpt', { ascending: true });

        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
            throw objectivesError;
        }

        res.json({
            success: true,
            data: objectives || []
        });
    } catch (error) {
        console.error('Error in getUserObjectives:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user objectives',
            error: error.message
        });
    }
},

updateSingleActivity: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const { trainingRecordId, activityId } = req.params;
        const { status, timestampzStarted, timestampzCompleted } = req.body;
        const userId = req.session.user.userId;

        console.log('🔄 [Single Activity] Updating activity with timestamps:', {
            trainingRecordId,
            activityId,
            status,
            timestampzStarted,
            timestampzCompleted,
            userId
        });

        // Verify training record belongs to user
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select('trainingRecordId, trainingId')
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError || !trainingRecord) {
            return res.status(404).json({
                success: false,
                message: 'Training record not found'
            });
        }

        // Check if activity record already exists
        const { data: existingActivity, error: checkError } = await supabase
            .from('training_records_activities')
            .select('trainingRecordActivityId, status, timestampzStarted, timestampzCompleted')
            .eq('trainingRecordId', trainingRecordId)
            .eq('activityId', activityId)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error('❌ [Single Activity] Error checking existing activity:', checkError);
            return res.status(500).json({
                success: false,
                message: 'Database error while checking activity record'
            });
        }

        // Prepare update data
        const updateData = {};
        if (status !== undefined) updateData.status = status;
        if (timestampzStarted !== undefined) updateData.timestampzStarted = timestampzStarted;
        if (timestampzCompleted !== undefined) updateData.timestampzCompleted = timestampzCompleted;

        let updatedActivity;

        if (existingActivity) {
            // Update existing record
            console.log('🔄 [Single Activity] Updating existing activity record:', existingActivity.trainingRecordActivityId);
            
            const { data: updateResult, error: updateError } = await supabase
                .from('training_records_activities')
                .update(updateData)
                .eq('trainingRecordActivityId', existingActivity.trainingRecordActivityId)
                .select()
                .single();

            if (updateError) {
                console.error('❌ [Single Activity] Error updating existing activity:', updateError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update activity: ' + updateError.message
                });
            }

            updatedActivity = updateResult;
        } else {
            // Insert new record
            console.log('➕ [Single Activity] Creating new activity record');
            
            const insertData = {
                trainingRecordId: parseInt(trainingRecordId),
                activityId: parseInt(activityId),
                ...updateData
            };

            const { data: insertResult, error: insertError } = await supabase
                .from('training_records_activities')
                .insert([insertData])
                .select()
                .single();

            if (insertError) {
                console.error('❌ [Single Activity] Error inserting new activity:', insertError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to create activity record: ' + insertError.message
                });
            }

            updatedActivity = insertResult;
        }

        // Update training progress - NEW LOGIC: Any activity change = In Progress
        console.log('🔄 [Single Activity] Updating training progress after activity change...');
        try {
            await this.updateTrainingProgress(trainingRecordId);
        } catch (progressError) {
            console.error('❌ [Single Activity] Failed to update training progress:', progressError);
        }

        console.log('✅ [Single Activity] Activity updated successfully:', updatedActivity);

        res.json({
            success: true,
            message: 'Activity updated successfully',
            data: updatedActivity
        });

    } catch (error) {
        console.error('❌ [Single Activity] Error updating single activity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update activity',
            error: error.message
        });
    }
},

// FIXED: Batch activities update without upsert
updateTrainingActivities: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const trainingRecordId = req.params.trainingRecordId;
        const userId = req.session.user.userId;
        const { activities } = req.body;

        console.log('🔄 [Batch Activities] Batch updating activities for training record:', trainingRecordId);
        console.log('🔄 [Batch Activities] Activities to update:', activities);

        if (!activities || !Array.isArray(activities)) {
            return res.status(400).json({
                success: false,
                message: 'Activities array is required'
            });
        }

        // Verify training record belongs to user
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select('trainingRecordId, trainingId')
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError || !trainingRecord) {
            console.error('❌ [Batch Activities] Training record not found:', recordError);
            return res.status(404).json({
                success: false,
                message: 'Training record not found'
            });
        }

        // Get all existing activity records for this training
        const { data: existingActivities, error: existingError } = await supabase
            .from('training_records_activities')
            .select('trainingRecordActivityId, activityId, status, timestampzStarted, timestampzCompleted')
            .eq('trainingRecordId', trainingRecordId);

        if (existingError) {
            console.error('❌ [Batch Activities] Error fetching existing activities:', existingError);
            return res.status(500).json({
                success: false,
                message: 'Database error while fetching existing activities'
            });
        }

        const updateResults = [];
        
        // Process each activity update
        for (const activity of activities) {
            try {
                console.log(`🔄 [Batch Activities] Processing activity ${activity.activityId}:`, activity);

                const existingActivity = existingActivities.find(ea => ea.activityId === activity.activityId);
                
                const updateData = {
                    status: activity.status || 'Not Started',
                    timestampzStarted: activity.timestampzStarted || null,
                    timestampzCompleted: activity.timestampzCompleted || null
                };

                let result;

                if (existingActivity) {
                    // Update existing record
                    const { data: updateResult, error: updateError } = await supabase
                        .from('training_records_activities')
                        .update(updateData)
                        .eq('trainingRecordActivityId', existingActivity.trainingRecordActivityId)
                        .select()
                        .single();

                    if (updateError) {
                        console.error('❌ [Batch Activities] Error updating activity:', updateError);
                        updateResults.push({ 
                            success: false, 
                            activityId: activity.activityId, 
                            error: updateError.message 
                        });
                        continue;
                    }

                    result = updateResult;
                } else {
                    // Insert new record
                    const insertData = {
                        trainingRecordId: parseInt(trainingRecordId),
                        activityId: activity.activityId,
                        ...updateData
                    };

                    const { data: insertResult, error: insertError } = await supabase
                        .from('training_records_activities')
                        .insert([insertData])
                        .select()
                        .single();

                    if (insertError) {
                        console.error('❌ [Batch Activities] Error inserting activity:', insertError);
                        updateResults.push({ 
                            success: false, 
                            activityId: activity.activityId, 
                            error: insertError.message 
                        });
                        continue;
                    }

                    result = insertResult;
                }

                updateResults.push({ 
                    success: true, 
                    activityId: activity.activityId,
                    data: result
                });

            } catch (error) {
                console.error('❌ [Batch Activities] Error processing activity:', error);
                updateResults.push({ 
                    success: false, 
                    activityId: activity.activityId, 
                    error: error.message 
                });
            }
        }

        // Update overall training progress - NEW LOGIC: Any activity change = In Progress
        console.log('🔄 [Batch Activities] Updating training progress after batch changes...');
        try {
            await this.updateTrainingProgress(trainingRecordId);
        } catch (progressError) {
            console.error('❌ [Batch Activities] Failed to update training progress:', progressError);
        }

        const successfulUpdates = updateResults.filter(result => result.success);
        const failedUpdates = updateResults.filter(result => !result.success);

        console.log('✅ [Batch Activities] Batch update completed:', {
            successful: successfulUpdates.length,
            failed: failedUpdates.length
        });

        res.json({
            success: successfulUpdates.length > 0,
            message: failedUpdates.length === 0 ? 
                `Updated ${successfulUpdates.length} activities successfully` :
                `Updated ${successfulUpdates.length} activities successfully, ${failedUpdates.length} failed`,
            updatedCount: successfulUpdates.length,
            failedCount: failedUpdates.length,
            details: updateResults
        });

    } catch (error) {
        console.error('❌ [Batch Activities] Error in batch update:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update activities',
            error: error.message
        });
    }
},

updateTrainingProgress: async function(trainingRecordId) {
    try {
        console.log(`🔄 [Training Progress] Updating progress for training record: ${trainingRecordId}`);

        // Check if there are any certificates uploaded for this training record
        const { data: certificates, error: certError } = await supabase
            .from('training_records_certificates')
            .select('certificate_url')
            .eq('trainingRecordId', trainingRecordId)
            .not('certificate_url', 'is', null);

        if (certError) {
            console.error('❌ [Training Progress] Error checking certificates:', certError);
            return;
        }

        let trainingStatus = 'Not Started';

        // If any certificate is uploaded, mark as Completed
        if (certificates && certificates.length > 0) {
            trainingStatus = 'Completed';
            console.log(`✅ [Training Progress] Found ${certificates.length} certificate(s), setting status to Completed`);
        } else {
            // Check if there are any activity records (any status change means In Progress)
            const { data: activities, error: activitiesError } = await supabase
                .from('training_records_activities')
                .select('status, trainingRecordActivityId')
                .eq('trainingRecordId', trainingRecordId);

            if (activitiesError) {
                console.error('❌ [Training Progress] Error fetching activities:', activitiesError);
                return;
            }

            // If there are any activity records, mark as In Progress
            if (activities && activities.length > 0) {
                trainingStatus = 'In Progress';
                console.log(`🔄 [Training Progress] Found ${activities.length} activity record(s), setting status to In Progress`);
            } else {
                console.log(`⏸️ [Training Progress] No activities or certificates found, keeping status as Not Started`);
            }
        }

        // Update training record status
        const { error: updateError } = await supabase
            .from('training_records')
            .update({ trainingStatus })
            .eq('trainingRecordId', trainingRecordId);

        if (updateError) {
            console.error('❌ [Training Progress] Error updating training status:', updateError);
        } else {
            console.log(`✅ [Training Progress] Training ${trainingRecordId} status updated to: ${trainingStatus}`);
        }

    } catch (error) {
        console.error('❌ [Training Progress] Error in updateTrainingProgress:', error);
    }
},

// UPDATED: Get training record details with timestamp fields
getTrainingRecordDetails: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const trainingRecordId = req.params.trainingRecordId;
        const userId = req.session.user.userId;
        
        // Fetch training record with training details
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select(`
                *,
                trainings!inner (
                    trainingId,
                    trainingName,
                    trainingDesc,
                    isOnlineArrangement,
                    totalDuration,
                    cost,
                    address,
                    country
                )
            `)
            .eq('trainingRecordId', trainingRecordId)
            .eq('userId', userId)
            .single();

        if (recordError || !trainingRecord) {
            return res.status(404).json({ 
                success: false, 
                message: 'Training record not found' 
            });
        }

        // Fetch activities with completion status (updated field names)
        const { data: activitiesData, error: activitiesError } = await supabase
            .from('training_activities')
            .select(`
                activityId,
                activityName,
                activityType,
                activityRemarks,
                estActivityDuration,
                trainingId
            `)
            .eq('trainingId', trainingRecord.trainings.trainingId);

        if (activitiesError) {
            console.error('Error fetching activities:', activitiesError);
        }

        // Fetch activity completion status with timestamp fields
        const { data: activityStatus, error: statusError } = await supabase
            .from('training_records_activities')
            .select('*')
            .eq('trainingRecordId', trainingRecordId);

        if (statusError) {
            console.error('Error fetching activity status:', statusError);
        }

        // Merge activities with their status
        const activities = (activitiesData || []).map(activity => {
            const status = (activityStatus || []).find(s => s.activityId === activity.activityId);
            return {
                ...activity,
                status: status?.status || 'Not Started',
                timestampzStarted: status?.timestampzStarted || null,
                timestampzCompleted: status?.timestampzCompleted || null,
                trainingRecordActivityId: status?.trainingRecordActivityId || null
            };
        });

        // Get activity counts
        const totalActivities = activities?.length || 0;
        const completedActivities = activities?.filter(
            activity => activity.status === 'Completed'
        ).length || 0;

        // Calculate percentage
        const percentage = totalActivities > 0 ? 
            Math.round((completedActivities / totalActivities) * 100) : 0;

        const enrichedRecord = {
            ...trainingRecord,
            trainingName: trainingRecord.trainings.trainingName,
            trainingDesc: trainingRecord.trainings.trainingDesc,
            isOnlineArrangement: trainingRecord.trainings.isOnlineArrangement,
            totalDuration: trainingRecord.trainings.totalDuration,
            cost: trainingRecord.trainings.cost,
            address: trainingRecord.trainings.address,
            country: trainingRecord.trainings.country,
            totalActivities,
            completedActivities,
            trainingPercentage: percentage,
            activities: activities || []
        };
        
        res.json({
            success: true,
            data: enrichedRecord
        });
    } catch (error) {
        console.error('Error fetching training record details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch training record details',
            error: error.message 
        });
    }
},


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

