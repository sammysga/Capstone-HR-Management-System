const { render } = require('ejs');
const supabase = require('../public/config/supabaseClient');
require('dotenv').config(); // To load environment variables
const bcrypt = require('bcrypt');
const { parse } = require('dotenv');
const flash = require('connect-flash/lib/flash');
const { getUserAccount, getPersInfoCareerProg } = require('./employeeController');

const hrController = {
    getHRDashboard: async function(req, res) {
        if (!req.session.user) {
            req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
            return res.redirect('/staff/login');
        }
    
        try {
            // Common function to fetch and format leave data
            const fetchAndFormatLeaves = async (statusFilter = null) => {
                const query = supabase
                    .from('leaverequests')
                    .select(`
                        leaveRequestId, 
                        userId, 
                        created_at, 
                        leaveTypeId, 
                        fromDate, 
                        untilDate, 
                        status,
                        useraccounts (
                            userId, 
                            userEmail,
                            staffaccounts (
                                departments (deptName), 
                                lastName, 
                                firstName
                            )
                        ), 
                        leave_types (
                            typeName
                        )
                    `)
                    .order('created_at', { ascending: false });
                
                if (statusFilter) query.eq('status', statusFilter);
                
                const { data, error } = await query;
                if (error) throw error;
                
                return data.map(leave => ({
                    lastName: leave.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
                    firstName: leave.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                    department: leave.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
                    filedDate: leave.created_at ? new Date(leave.created_at).toISOString().split('T')[0] : 'N/A',
                    type: leave.leave_types?.typeName || 'N/A',
                    startDate: leave.fromDate || 'N/A',
                    endDate: leave.untilDate || 'N/A',
                    status: leave.status || 'Pending'
                }));
            };
    
            // Function to fetch attendance logs
            const fetchAttendanceLogs = async () => {
                const { data: attendanceLogs, error: attendanceError } = await supabase
                    .from('attendance')
                    .select(`
                        userId, 
                        attendanceDate, 
                        attendanceAction, 
                        attendanceTime, 
                        useraccounts (
                            userId, 
                            staffaccounts (
                                staffId,
                                firstName, 
                                lastName,
                                departmentId, 
                                jobId,
                                departments: departmentId ("deptName"),
                                jobpositions: jobId ("jobTitle")
                            )
                        )
                    `)
                    .order('attendanceDate', { ascending: false });
    
                if (attendanceError) {
                    console.error('Error fetching attendance logs:', attendanceError);
                    throw new Error('Error fetching attendance logs.');
                }
    
                return attendanceLogs;
            };
    
            // Function to format attendance logs
            const formatAttendanceLogs = (attendanceLogs) => {
                const formattedAttendanceLogs = attendanceLogs.reduce((acc, attendance) => {
                    const attendanceDate = attendance.attendanceDate;
                    const attendanceTime = attendance.attendanceTime || '00:00:00';
                    const [hours, minutes, seconds] = attendanceTime.split(':').map(Number);
                    const localDate = new Date(attendanceDate);
                    localDate.setHours(hours, minutes, seconds);
    
                    const userId = attendance.userId;
                    const existingEntry = acc.find(log => log.userId === userId && log.date === attendanceDate);
    
                    if (attendance.attendanceAction === 'Time In') {
                        if (existingEntry) {
                            existingEntry.timeIn = localDate;
                        } else {
                            acc.push({
                                userId,
                                date: attendanceDate,
                                timeIn: localDate,
                                timeOut: null,
                                useraccounts: attendance.useraccounts
                            });
                        }
                    } else if (attendance.attendanceAction === 'Time Out') {
                        if (existingEntry) {
                            existingEntry.timeOut = localDate;
                        } else {
                            acc.push({
                                userId,
                                date: attendanceDate,
                                timeIn: null,
                                timeOut: localDate,
                                useraccounts: attendance.useraccounts
                            });
                        }
                    }
    
                    return acc;
                }, []);
    
                return formattedAttendanceLogs.map(log => {
                    const activeWorkingHours = log.timeIn && log.timeOut ? (log.timeOut - log.timeIn) / 3600000 : 0;
    
                    return {
                        department: log.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
                        firstName: log.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                        lastName: log.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
                        jobTitle: log.useraccounts?.staffaccounts[0]?.jobpositions?.jobTitle || 'N/A',
                        date: log.timeIn ? new Date(log.timeIn).toISOString().split('T')[0] : 'N/A',
                        timeIn: log.timeIn ? log.timeIn.toLocaleTimeString() : 'N/A',
                        timeOut: log.timeOut ? log.timeOut.toLocaleTimeString() : 'N/A',
                        activeWorkingHours: activeWorkingHours.toFixed(2)
                    };
                });
            };

            // // Function to fetch and format MRF data
            // const fetchManpowerRequisitions = async () => {
            //     const { data: requisitions, error: requisitionError } = await supabase
            //         .from('mrf')
            //         .select(`
            //             mrfId,
            //             positionTitle, 
            //             requisitionDate,
            //             status,
            //             useraccounts (
            //                 firstName, 
            //                 lastName, 
            //                 departments (deptName)
            //             )
            //         `)
            //         .order('requisitionDate', { ascending: false });
                
            //     if (requisitionError) {
            //         console.error('Error fetching requisition data for HR dashboard:', requisitionError);
            //         throw new Error('Error fetching requisition data.');
            //     }

            //     return requisitions.map(req => ({
            //         requisitionerName: `${req.staffaccounts?.firstName || 'N/A'} ${req.staffaccounts?.lastName || 'N/A'}`, // Full name of the requisitioner
            //         department: req.staffaccounts?.departments?.deptName || 'N/A',  // Department name
            //         position: req.positionTitle || 'N/A',  // Position title requested
            //         requestDate: req.requisitionDate ? new Date(req.requisitionDate).toISOString().split('T')[0] : 'N/A',  // Date formatting
            //         status: req.status || 'Pending'  // Status of the requisition
            //     }));
            // };
    
            // Initialize attendanceLogs variable
            let attendanceLogs = [];
            if (req.session.user.userRole === 'Line Manager') {
                const formattedLeaves = await fetchAndFormatLeaves();
                attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
                // const formattedManpowerRequisitions = await fetchManpowerRequisitions();
                
                return res.render('staffpages/hr_pages/hrdashboard', {
                    formattedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors'),
                    // manpowerRequisitions: formattedManpowerRequisitions
                });
    
            } else if (req.session.user.userRole === 'HR') {
                const [formattedAllLeaves, formattedApprovedLeaves] = await Promise.all([
                    fetchAndFormatLeaves(),
                    fetchAndFormatLeaves('Approved')
                ]);
    
                attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
                // const formattedManpowerRequisitions = await fetchManpowerRequisitions();
        
                return res.render('staffpages/hr_pages/hrdashboard', { 
                    allLeaves: formattedAllLeaves, 
                    approvedLeaves: formattedApprovedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors'),
                    // manpowerRequisitions: formattedManpowerRequisitions
                });
            }
        } catch (err) {
            console.error('Error fetching data for the dashboard:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
            return res.redirect('/hr/dashboard');
        }
    },
    
    getManageLeaveTypes: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch leave types from the Supabase database
                const { data: leaveTypes, error } = await supabase
                    .from('leave_types')
                    .select('leaveTypeId, typeName, typeMaxCount, typeIsActive');
    
                if (error) {
                    throw error; // Handle error
                }
    
                // Process the leave types to send to frontend
                const processedLeaveTypes = leaveTypes.map(leaveType => ({
                    leaveTypeId: leaveType.leaveTypeId,
                    typeName: leaveType.typeName,
                    typeMaxCount: leaveType.typeMaxCount,
                    typeIsActive: leaveType.typeIsActive // Keep it as a boolean
                }));
    
                // Send response with leave types
                res.render('staffpages/hr_pages/hrmanageleavetypes', { 
                    leaveTypes: processedLeaveTypes 
                });
            } catch (err) {
                console.error("Error fetching leave types:", err);
                req.flash('errors', { dbError: 'An error occurred while loading leave types.' });
                res.redirect('/hr/dashboard'); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    updateLeaveTypes: async (req, res) => {
        const { typeMaxCount, typeIsActive } = req.body; 
        const { leaveTypeId } = req.params; 
    
        try {
            const isActive = typeIsActive === 'true'; // Ensure it's a boolean
    
            const { data, error } = await supabase
                .from('leave_types')
                .update({
                    typeMaxCount: typeMaxCount,
                    typeIsActive: isActive // Use boolean value
                })
                .eq('leaveTypeId', leaveTypeId);
    
            if (error) {
                return res.status(400).json({ message: 'Error updating leave type', error });
            }
    
            res.status(200).json({ message: 'Leave type updated successfully', data });
        } catch (err) {
            console.error('Error updating leave type:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    },
    
    
    getUserAccount: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
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
                return res.redirect('/linemanager/dashboard');
            }

            const userData = {
                ...user,
                firstName: staff.firstName,
                lastName: staff.lastName
            };

            res.render('staffpages/linemanager_pages/manageruseraccount', { user: userData });
        } catch (err) {
            console.error('Error in getUserAccount controller:', err);
            req.flash('errors', { dbError: 'An error occured while loading the account page.' });
            res.redirect('/linemanager/dashboard');
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
    

    updateUserInfo: async function (req, res) {
        try {
            const userId = req.session.user.userId;
            const { firstName, lastName, userEmail } = req.body;

            // Update the user info in both 'useraccounts' and 'staffaccounts' tables
            const { error: userError } = await supabase
                .from('useraccounts')
                .update({ userEmail })
                .eq('userId', userId);

            const { error: staffError } = await supabase
                .from('staffaccounts')
                .update({ firstName, lastName })
                .eq('userId', userId);

            if (userError || staffError) {
                console.error('Error updating user information:', userError || staffError);
                req.flash('errors', { dbError: 'Error updating user information.' });
                return res.redirect('staffpages/hr_pages/hruseraccount');
            }

            req.flash('success', 'User information updated successfully!');
            res.redirect('staffpages/hr_pages/hruseraccount');
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/hr_pages/hruseraccount')
        }
    },

    getPersInfoCareerProg: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
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
                return res.redirect('/hr/dashboard');
            }
    
            const userData = {
                ...user,
                firstName: staff.firstName,
                lastName: staff.lastName,
                phoneNumber: '123-456-7890', // Dummy phone number
                dateOfBirth: '1990-01-01', // Dummy date of birth
                emergencyContact: 'Jane Doe (123-456-7890)' // Dummy emergency contact
            };
    
            res.render('staffpages/hr_pages/persinfocareerprog', { user: userData });
        } catch (err) {
            console.error('Error in getPersInfoCareerProg controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/hr/dashboard');
        }
    },

    updatePersUserInfo: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            const { userEmail, phone, dateOfBirth, emergencyContact, employmentType, jobTitle, department, hireDate } = req.body;
    
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
                return res.redirect('staffpages/hr_pages/persinfocareerprog');
            }

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
                return res.redirect('staffpages/hr_pages/persinfocareerprog');
            }
    
            req.flash('success', { updateSuccess: 'User information updated successfully!' });
            res.redirect('staffpages/hr_pages/persinfocareerprog');
    
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/hr_pages/persinfocareerprog');
        }
    },
    

    getHRManageHome: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // fetch announcements from the database
                const { data: announcements, error } = await supabase
                    .from('announcements')
                    .select('*')
                    .order('createdAt', { ascending: false });
    
                if (error) throw error;
    
                res.render('staffpages/hr_pages/hrmanagehome', { announcements });
            } catch (error) {
                console.error('Error fetching announcements:', error);
                req.flash('errors', { fetchError: 'Failed to load announcements. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    

    getAddAnnouncement: function(req, res){
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hraddannouncement');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    postAddAnnouncement: async function(req, res) {
        console.log('Request Body:', req.body); // Log the entire request body
        
        if (req.session.user && req.session.user.userRole === 'HR') {
        const { subject, content } = req.body; // Destructure the subject and content from the request body

        console.log('Received Subject:', subject);
        console.log('Received Content:', content);

        // Validate subject and content
        if (!subject || !content) {
            return res.status(400).json({ error: 'Subject and content are required.' });
        }

        try {
            const { data: announcements, error } = await supabase
                .from('announcements')
                .insert([{
                    subject,
                    imageUrl: null, // Set to null if no file is uploaded
                    content,
                    createdAt: new Date()
                }]);
            
            if (error) throw error;

            req.flash('success', 'Announcement added successfully!');
            res.status(200).json({ success: true });
            } catch (error) {
                console.error('Error adding announcement:', error);
                return res.status(500).json({ error: 'Failed to add announcement. Please try again' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    getEditAnnouncement: async function(req, res) {
        const { announcementID } = req.params;
        
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { data: announcement, error } = await supabase
                    .from('announcements')
                    .select('*')
                    .eq('id', announcementID)
                    .single(); 

                if (error) throw error;

                res.render('staffpages/hr_pages/hreditannouncement', { announcement });
            } catch (error) {
                console.error('Error fetching announcement:', error);
                req.flash('errors', { fetchError: 'Failed to load announcement. Please try again.' });
                res.redirect('/hr/managehome');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    updateAnnouncement: async function(req, res) {
        const { announcementID } = req.params;
        const { subject, content } = req.body;
    
        console.log('Update Request Body:', req.body); 
    
        if (req.session.user && req.session.user.userRole === 'HR') {

            if (!subject || !content) {
                return res.status(400).json({ error: 'Subject and content are required.' });
            }
    
            try {
                const { error } = await supabase
                    .from('announcements')
                    .update({ subject, content, updatedAt: new Date() }) 
                    .eq('id', announcementID); 
    
                if (error) throw error;
    
                req.flash('success', 'Announcement updated successfully.');
                res.redirect('/hr/managehome'); 
            } catch (error) {
                console.error('Error updating announcement:', error);
                req.flash('errors', { updateError: 'Failed to update announcement. Please try again.' });
                res.redirect(`/hr/editannouncement/${announcementID}`); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    deleteAnnouncement: async function (req, res) {
        const { announcementID } = req.params;

        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { error } = await supabase
                    .from('announcements')
                    .delete()
                    .eq('announcementID', announcementID);

                if (error) throw error;

                res.status(200).send('Announcement deleted successfully.');
            } catch (error) {
                console.error('Error deleting announcement:', error);
                res.status(500).send('Failed to delete announcement. Please try again.');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only. '});
            res.redirect('/staff/login');
        }
    },

    getJobOffers: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { data: jobPositions, error } = await supabase
                    .from('jobpositions')
                    .select(`
                        *,
                        departments (deptName)  // fetching the department name from the departments table
                    `);
    
                if (error) throw error;

                // to be deleted later on
                console.log('Job Positions:', jobPositions);

                // mapping to include dept names instead of deptId
                const jobPositionsWithNames = jobPositions.map(position => ({
                    ...position,
                    department: position.departments ? position.departments.deptName : 'Unknown'
                }));
            
                res.render('staffpages/hr_pages/hrjoboffers', { jobPositions: jobPositionsWithNames });
            } catch (error) {
                console.error('Error fetching job postings:', error);
                req.flash('errors', { fetchError: 'Failed to load job postings. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    // Controller function to handle job offer update
updateJobOffer: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'HR') {
        try {
            const jobId = req.params.id;
            const { jobTitle, jobDescrpt, departmentId, jobType, isActiveHiring } = req.body;

            // Update the job offer in the 'jobpositions' table
            const { error } = await supabase
                .from('jobpositions')
                .update({
                    jobTitle,
                    jobDescrpt,
                    departmentId,
                    jobType,
                    isActiveHiring
                })
                .eq('id', jobId);

            if (error) throw error;

            req.flash('success', { message: 'Job offer updated successfully!' });
            res.redirect('/hr/joboffers');
        } catch (error) {
            console.error('Error updating job offer:', error);
            req.flash('errors', { updateError: 'Failed to update job offer. Please try again.' });
            res.redirect(`/hr/editjoboffers/${req.params.id}`);
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized. HR access only.' });
        res.redirect('/staff/login');
    }
},
    
    getAddJobOffer: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hraddjoboffers');
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    postAddJobOffer: async function (req, res) {
        // Check if the user is HR
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Extract data from the request body
                const {
                    jobTitle, departmentId, jobDescrpt, jobType, jobTimeCommitment,
                    hiringStartDate, hiringEndDate,
                    jobReqCertificateType, jobReqCertificateDescrpt,
                    jobReqDegreeType, jobReqDegreeDescrpt,
                    jobReqExperienceType, jobReqExperienceDescrpt, jobReqSkillType, jobReqSkillName
                } = req.body;
    
                // Determine if the job is currently active based on hiring dates
                const currentDate = new Date();
                const startDate = new Date(hiringStartDate);
                const endDate = new Date(hiringEndDate);
                const isActiveHiring = currentDate >= startDate && currentDate <= endDate;
    
                // Insert the basic job posting into the jobpositions table
                const { data: jobData, error: jobError } = await supabase
                    .from('jobpositions')
                    .insert([{
                        jobTitle,
                        departmentId: parseInt(departmentId),
                        jobDescrpt,
                        jobType,
                        jobTimeCommitment,
                        hiringStartDate,
                        hiringEndDate,
                        isActiveHiring // Use the computed value
                    }])
                    .select(); // Return the inserted row with its jobId
    
                if (jobError) throw jobError;
    
                const jobId = jobData[0].jobId; // Get the jobId from the inserted row
    
                // Insert certifications if provided
                if (jobReqCertificateType && Array.isArray(jobReqCertificateType) && jobReqCertificateDescrpt && Array.isArray(jobReqCertificateDescrpt)) {
                    const certData = jobReqCertificateType.map((certType, index) => ({
                        jobId,
                        jobReqCertificateType: certType,
                        jobReqCertificateDescrpt: jobReqCertificateDescrpt[index]
                    }));
                    const { error: certError } = await supabase
                        .from('jobreqcertifications')
                        .insert(certData);
                    if (certError) throw certError;
                }
    
                // Insert degrees if provided
                if (jobReqDegreeType && Array.isArray(jobReqDegreeType) && jobReqDegreeDescrpt && Array.isArray(jobReqDegreeDescrpt)) {
                    const degreeData = jobReqDegreeType.map((degreeType, index) => ({
                        jobId,
                        jobReqDegreeType: degreeType,
                        jobReqDegreeDescrpt: jobReqDegreeDescrpt[index]
                    }));
                    const { error: degreeError } = await supabase
                        .from('jobreqdegrees')
                        .insert(degreeData);
                    if (degreeError) throw degreeError;
                }
    
                // Insert experiences if provided
                if (jobReqExperienceType && Array.isArray(jobReqExperienceType) && jobReqExperienceDescrpt && Array.isArray(jobReqExperienceDescrpt)) {
                    const experienceData = jobReqExperienceType.map((experienceType, index) => ({
                        jobId,
                        jobReqExperienceType: experienceType,
                        jobReqExperienceDescrpt: jobReqExperienceDescrpt[index]
                    }));
                    const { error: experienceError } = await supabase
                        .from('jobreqexperiences')
                        .insert(experienceData);
                    if (experienceError) throw experienceError;
                }
    
                // Insert skills if provided
                if (jobReqSkillType && Array.isArray(jobReqSkillType) && jobReqSkillName && Array.isArray(jobReqSkillName)) {
                    const skillData = jobReqSkillType.map((skillType, index) => ({
                        jobId,
                        jobReqSkillType: skillType,
                        jobReqSkillName: jobReqSkillName[index]
                    }));
                    const { error: skillError } = await supabase
                        .from('jobreqskills')
                        .insert(skillData);
                    if (skillError) throw skillError;
                }
    
                // Success response: redirect to job postings page
                // Use redirect instead of JSON response here
                res.redirect('/hr/joboffers');
                
            } catch (error) {
                console.error('Error adding job postings and requirements:', error);
                // Handle error response
                res.status(500).json({ error: 'Failed to add job posting. Please try again.' });
            }
        } else {
            // Handle unauthorized access
            res.status(403).json({ errors: 'Unauthorized. HR access only.' });
            // No need to redirect here as JSON response is sent
        }
    },
    
    getEditJobOffers: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const jobId = req.params.id;  // Get jobId from URL params
                console.log('Requested Job ID:', jobId);  // Log the requested job ID
        
                // Fetch job details along with department information
                const { data: job, error } = await supabase
                    .from('jobpositions')
                    .select(`
                        *,
                        departments (deptName)  // Fetching the department name from the departments table
                    `)
                    .eq('jobId', jobId)  // Use the jobId to filter
                    .single();  // Ensures only one result is returned
        
                // Check if the job was found
                if (error || !job) {
                    console.error(`Job with ID ${jobId} not found.`);
                    req.flash('errors', { fetchError: 'Job not found.' });
                    return res.redirect('/hr/joboffers');  // Redirect if job is not found
                }
        
                console.log('Fetched Job:', job);  // Log the fetched job data
        
                // Fetch job skills
                const { data: jobSkills, error: jobSkillsError } = await supabase
                    .from('jobreqskills')
                    .select('*')
                    .eq('jobId', jobId);
        
                if (jobSkillsError) {
                    console.error('Error fetching job skills:', jobSkillsError);
                    req.flash('errors', { fetchError: 'Error fetching job skills.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Separate hard and soft skills
                const hardSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Hard");
                const softSkills = jobSkills.filter(skill => skill.jobReqSkillType === "Soft");
        
                // Fetch job certifications
                const { data: certifications, error: certificationsError } = await supabase
                    .from('jobreqcertifications')
                    .select('jobReqCertificateType, jobReqCertificateDescrpt')
                    .eq('jobId', jobId);
        
                if (certificationsError) {
                    console.error('Error fetching job certifications:', certificationsError);
                    req.flash('errors', { fetchError: 'Error fetching job certifications.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Fetch job degrees
                const { data: degrees, error: degreesError } = await supabase
                    .from('jobreqdegrees')
                    .select('jobReqDegreeType, jobReqDegreeDescrpt')
                    .eq('jobId', jobId);
        
                if (degreesError) {
                    console.error('Error fetching job degrees:', degreesError);
                    req.flash('errors', { fetchError: 'Error fetching job degrees.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Fetch job experiences
                const { data: experiences, error: experiencesError } = await supabase
                    .from('jobreqexperiences')
                    .select('jobReqExperienceType, jobReqExperienceDescrpt')
                    .eq('jobId', jobId);
        
                if (experiencesError) {
                    console.error('Error fetching job experiences:', experiencesError);
                    req.flash('errors', { fetchError: 'Error fetching job experiences.' });
                    return res.redirect('/hr/joboffers');
                }
        
                // Render the job edit page with all the data
                res.render('staffpages/hr_pages/hreditjoboffers', { 
                    job, 
                    hardSkills, 
                    softSkills, 
                    certifications, 
                    degrees, 
                    experiences
                });
        
            } catch (error) {
                console.error('Error fetching job offer:', error);
                req.flash('errors', { fetchError: 'Failed to fetch job offer.' });
                res.redirect('/hr/joboffers');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    
    

    getHRManageStaff: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch data from Supabase
                const { data: staffAccounts, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('staffId, userId, departmentId, jobId, lastName, firstName');
                if (staffError) throw staffError;
    
                const { data: userAccounts, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail, userRole, userIsDisabled, userStaffOgPass');
                if (userError) throw userError;
    
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                if (deptError) throw deptError;
    
                const { data: jobPositions, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, departmentId, jobTitle');
                if (jobError) throw jobError;
    
                // Map and combine staff data
                const staffList = await Promise.all(staffAccounts.map(async (staff) => {
                    const userAccount = userAccounts.find(user => user.userId === staff.userId);
                    const department = departments.find(dept => dept.departmentId === staff.departmentId);
                    const jobPosition = jobPositions.find(job => job.jobId === staff.jobId);
    
                    let jobTitle = jobPosition ? jobPosition.jobTitle : 'No job title assigned';
                    let userRole = userAccount ? userAccount.userRole : 'Unknown';
                    let deptName = department ? department.deptName : 'Unknown';
    
                    return {
                        deptName,
                        jobTitle,
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: userAccount ? userAccount.userEmail : 'N/A',
                        userRole,
                        userStaffOgPass: userAccount ? userAccount.userStaffOgPass : 'N/A',
                        activeStatus: userAccount && userAccount.userIsDisabled ? 'Disabled' : 'Active'
                    };
                }));
    
                // Group staff by department
                const groupedByDept = departments.map(dept => ({
                    deptName: dept.deptName,
                    staff: staffList.filter(staff => staff.deptName === dept.deptName)
                }));
    
                // Pass grouped data to the EJS template
                const errors = req.flash('errors') || {};
                res.render('staffpages/hr_pages/hrmanagestaff', { errors, departments: groupedByDept });
            } catch (error) {
                console.error('Error fetching HR Manage Staff data:', error);
                req.flash('errors', { fetchError: 'Failed to fetch staff data. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    getDepartments: async function(req, res) {
        try {
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName');
            if (deptError) throw deptError;
            res.json(departments);
        } catch (error) {
            console.error('Error fetching departments:', error);
            res.status(500).json({ error: 'Error fetching departments' });
        }
    },

    getJobTitles: async function(req, res) {
        const departmentId = req.query.departmentId;
        try {
            const { data: jobTitles, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle')
                .eq('departmentId', departmentId);
            if (jobError) throw jobError;
            res.json(jobTitles);
        } catch (error) {
            console.error('Error fetching job titles:', error);
            res.status(500).json({ error: 'Error fetching job titles' });
        }
    },

    // Add a new department on the select picker on add new staff form
    addNewDepartment: async function(req, res) {
        const { deptName } = req.body;  // Assuming department name is sent in the body of the request
        try {
            // Insert new department
            const { data, error } = await supabase
                .from('departments')
                .insert([{ deptName }]); // Add department
            if (error) throw error;
            res.status(201).json({ message: 'New department added', department: data });
        } catch (error) {
            console.error('Error adding department:', error);
            res.status(500).json({ error: 'Error adding department' });
        }
    },
    
    // Add a new job title on the select picker on add new staff form
    addNewJobTitle: async function(req, res) {
        const { jobTitle, departmentId } = req.body;  // Assuming jobTitle and departmentId are sent in the request body
        try {
            // Insert new job title
            const { data, error } = await supabase
                .from('jobpositions')
                .insert([{ jobTitle, departmentId }]); // Add job title under specific department
            if (error) throw error;
            res.status(201).json({ message: 'New job title added', jobTitle: data });
        } catch (error) {
            console.error('Error adding job title:', error);
            res.status(500).json({ error: 'Error adding job title' });
        }
    },

    
    getAddStaffForm: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                if (deptError) throw deptError;

                const { data: jobPositions, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle, departmentId');
                if (jobError) throw jobError;

                const jobPositionsByDept = {};
                departments.forEach(dept => {
                    jobPositionsByDept[dept.departmentId] = jobPositions.filter(
                        job => job.departmentId === dept.departmentId
                    );
                });

                res.render('staffpages/hr_pages/addstaff', { 
                    departments, 
                    jobPositionsByDept
                });
            } catch (error) {
                console.error('Error fetching data for Add Staff form:', error);
                req.flash('errors', { fetchError: 'Failed to load form data. Please try again.' });
                res.redirect('/hr/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    addNewStaff: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            const { departmentId, jobId, lastName, firstName, email, role, passwordOption, customPassword, generatedPassword } = req.body;
    
            console.log('Request Body:', req.body);
            console.log('Password Option:', passwordOption);
            console.log('Custom Password:', customPassword);
            console.log('Generated Password:', generatedPassword);
    
            try {
                // Handle password option
                let password;
                if (passwordOption === 'custom') {
                    password = customPassword;
                } else if (passwordOption === 'random') {  // Corrected this line
                    password = generatedPassword;
                } else {
                    throw new Error('Invalid password option');
                }
    
                // Check if password is provided
                if (!password) {
                    throw new Error('Password is required');
                }
    
                console.log('Password before hashing:', password);
    
                // Hash the password
                const hashedPassword = await bcrypt.hash(password, 10);
                console.log('Hashed Password:', hashedPassword);
    
                // Insert into useraccounts table
                const { data: userData, error: userError } = await supabase
                    .from('useraccounts')
                    .insert([{
                        userPass: hashedPassword,
                        userRole: role,
                        userIsDisabled: false,
                        userEmail: email,
                        userStaffOgPass: password // Store the actual password
                    }])
                    .select()
                    .single();
    
                if (userError) {
                    console.error('User Insert Error:', userError);
                    throw userError;
                }
    
                const userId = userData.userId;
    
                // Insert into staffaccounts table
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .insert([{
                        userId,
                        departmentId,
                        jobId,
                        lastName,
                        firstName
                    }])
                    .select()
                    .single();
    
                if (staffError) {
                    console.error('Staff Insert Error:', staffError);
                    throw staffError;
                }
    
                res.status(200).json({ message: 'Staff added successfully.' });
                console.log('Staff data:', staffData);
    
            } catch (error) {
                console.error('Error adding staff:', error.message);
                res.status(500).json({ error: `Error adding staff. Please try again. ${error.message}` });
            }
        } else {
            res.status(403).json({ error: 'Unauthorized access' });
        }
    },

    // Leave Request functionality
    getLeaveRequestForm: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const leaveTypes = [
                    { leaveTypeId: 1, typeName: 'Sick Leave' },
                    { leaveTypeId: 2, typeName: 'Vacation Leave' },
                    { leaveTypeId: 3, typeName: 'Emergency Leave' },
                    { leaveTypeId: 4, typeName: 'Maternity Leave' },
                    { leaveTypeId: 5, typeName: 'Paternity Leave' }
                ];
                
                res.render('staffpages/hr_pages/hrleaverequest', { leaveTypes });
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
        if (!req.session.user || !req.session.user.userId) {
            return res.status(401).json({ message: 'Unauthorized access' });
        }
    
        const { leaveType, dayType, reason, fromDate, toDate, halfDayDate, startTime, endTime } = req.body;
    
        if (!leaveType || !dayType || !reason) {
            return res.status(400).json({ message: 'Leave type, day type, and reason are required.' });
        }
    
        try {
            const { error } = await supabase
                .from('leave_requests')
                .insert([
                    {
                        userId: req.session.user.userId, 
                        leaveType,
                        dayType,
                        reason,
                        fromDate,
                        toDate,
                        halfDayDate,
                        startTime,
                        endTime,
                        status: 'Pending for Approval', 
                        submittedAt: new Date()
                    }
                ]);
    
            if (error) throw error;
    
            res.status(200).json({ message: 'Leave request submitted successfully' });
        } catch (error) {
            console.error('Error submitting leave request:', error);
            res.status(500).json({ message: 'Internal server error', error: error.message });
        }
    }, 

    
    //TODO: Backend for career progression onwards - ongoing, will prio objective and performance review tracker (charisse)
    getRecordsPerformanceTracker: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                console.log("Fetching performance tracker records...");
        
                // Fetch staff-related data
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select(`
                        staffId, 
                        userId, 
                        departmentId, 
                        jobId, 
                        lastName, 
                        firstName,
                        useraccounts (
                            userId, 
                            userEmail
                        ),
                        departments (
                            deptName
                        ),
                        jobpositions (
                            jobTitle
                        )
                    `)
                    .order('lastName', { ascending: true });
        
                if (staffError) throw staffError;
        
                console.log("Staff data fetched successfully:", staffData);
        
                // Fetch job-related data (job requirements)
                const { data: jobReqCertifications, error: certificationsError } = await supabase
                    .from('jobreqcertifications')
                    .select(`
                        jobId,
                        jobReqCertificateId,
                        jobReqCertificateDescrpt,
                        jobReqCertificateType
                    `);
        
                if (certificationsError) throw certificationsError;
        
                const { data: jobReqDegrees, error: degreesError } = await supabase
                    .from('jobreqdegrees')
                    .select(`
                        jobId,
                        jobReqDegreeId,
                        jobReqDegreeType,
                        jobReqDegreeDescrpt
                    `);
        
                if (degreesError) throw degreesError;
        
                const { data: jobReqExperiences, error: experiencesError } = await supabase
                    .from('jobreqexperiences')
                    .select(`
                        jobId,
                        jobReqExperienceId,
                        jobReqExperienceType,
                        jobReqExperienceDescrpt
                    `);
        
                if (experiencesError) throw experiencesError;
        
                const { data: jobReqSkills, error: skillsError } = await supabase
                    .from('jobreqskills')
                    .select(`
                        jobId,
                        jobReqSkillId,
                        jobReqSkillType,
                        jobReqSkillName
                    `);
        
                if (skillsError) throw skillsError;
        
                // Map fetched data to a structured employee list grouped by department
                const departmentMap = staffData.reduce((acc, staff) => {
                    const deptName = staff.departments?.deptName || 'Unknown';
                    if (!acc[deptName]) {
                        acc[deptName] = [];
                    }
        
                    // Find job requirements by matching jobId
                    const jobReqCertificationsByJob = jobReqCertifications.filter(cert => cert.jobId === staff.jobId);
                    const jobReqDegreesByJob = jobReqDegrees.filter(degree => degree.jobId === staff.jobId);
                    const jobReqExperiencesByJob = jobReqExperiences.filter(experience => experience.jobId === staff.jobId);
                    const jobReqSkillsByJob = jobReqSkills.filter(skill => skill.jobId === staff.jobId);
        
                    // Check if any job requirements are missing
                    const isJobRequirementsMissing = !(jobReqCertificationsByJob.length > 0 &&
                        jobReqDegreesByJob.length > 0 &&
                        jobReqExperiencesByJob.length > 0 &&
                        jobReqSkillsByJob.length > 0);
        
                    acc[deptName].push({
                        userId: staff.userId,
                        jobTitle: staff.jobpositions?.jobTitle || 'No job title assigned',
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: staff.useraccounts?.userEmail || 'N/A',
                        isJobRequirementsMissing,  // Flag indicating missing job requirements
                        hasJobRequirements: !isJobRequirementsMissing,  // Flag for existing job requirements
                        jobId: staff.jobId,
                        jobReqCertifications: jobReqCertificationsByJob,
                        jobReqDegrees: jobReqDegreesByJob,
                        jobReqExperiences: jobReqExperiencesByJob,
                        jobReqSkills: jobReqSkillsByJob
                    });
                    return acc;
                }, {});
        
                // Render the data in the view
                res.render('staffpages/hr_pages/hrrecordsperftracker', { departments: departmentMap });
        
            } catch (error) {
                console.error("Error fetching performance tracker data:", error);
                res.status(500).send("Error fetching performance tracker data");
            }
        } else {
            res.redirect('/login');
        }
    },
      
    
    getRecordsPerformanceTrackerByUserId: async function(req, res) {
        try {
            const userId = req.params.userId;  // Retrieve userId from URL params
            console.log('Fetching records for userId:', userId);
    
            if (!userId) {
                req.flash('errors', { authError: 'User not logged in.' });
                return res.redirect('/staff/login');
            }
    
            // Single query to fetch all user-related data
            const { data: userData, error } = await supabase
                .from('useraccounts')
                .select(`
                    userEmail, 
                    userRole, 
                    staffaccounts (
                        firstName, 
                        lastName, 
                        phoneNumber, 
                        dateOfBirth, 
                        emergencyContactName, 
                        emergencyContactNumber, 
                        employmentType, 
                        hireDate, 
                        staffId, 
                        jobId,
                        departmentId,
                        departments (
                            deptName
                        ),
                        jobpositions (
                            jobTitle
                        ),
                        staffdegrees (
                            degreeName, 
                            universityName, 
                            graduationYear
                        ),
                        staffcareerprogression (
                            milestoneName, 
                            startDate, 
                            endDate
                        ),
                        staffexperiences (
                            companyName, 
                            startDate
                        ),
                        staffcertification!staffcertification_staffId_fkey (
                            certificateName, 
                            certDate
                        )
                    )
                `)
                .eq('userId', userId)
                .single();
    
            if (error) throw error;
    
            console.log('Fetched user data:', userData);
    
            // Compile the userData into the format required for the template
            const formattedUserData = {
                userEmail: userData.userEmail || '',
                userRole: userData.userRole || '',
                // Accessing the first item in the staffaccounts array
                firstName: userData.staffaccounts[0]?.firstName || '',
                lastName: userData.staffaccounts[0]?.lastName || '',
                phoneNumber: userData.staffaccounts[0]?.phoneNumber || '',
                dateOfBirth: userData.staffaccounts[0]?.dateOfBirth || '',
                emergencyContactName: userData.staffaccounts[0]?.emergencyContactName || '',
                emergencyContactNumber: userData.staffaccounts[0]?.emergencyContactNumber || '',
                employmentType: userData.staffaccounts[0]?.employmentType || '',
                hireDate: userData.staffaccounts[0]?.hireDate || '',
                jobTitle: userData.staffaccounts[0]?.jobpositions?.jobTitle || '',
                departmentName: userData.staffaccounts[0]?.departments?.deptName || '',
                milestones: userData.staffaccounts[0]?.staffcareerprogression || [],
                degrees: userData.staffaccounts[0]?.staffdegrees || [],
                experiences: userData.staffaccounts[0]?.staffexperiences || [],
                certifications: userData.staffaccounts[0]?.staffcertification || []
            };
    
            console.log('Compiled user data:', formattedUserData);
    
            res.render('staffpages/hr_pages/hrrecordsperftracker-user', {
                user: formattedUserData,
                errors: req.flash('errors')
            });
        } catch (err) {
            console.error('Error in getRecordsPerformanceTrackerByUserId controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('staffpages/hr_pages/hrrecordsperftracker');
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

module.exports = hrController;
