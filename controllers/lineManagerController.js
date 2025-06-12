const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { getISOWeek } = require('date-fns');
const { getEmailTemplateData } = require('../utils/emailService');



async function getLeaveTypeName(leaveTypeId) {
    try {
        // Query the leave types table to get the name
        const { data, error } = await supabase
            .from('leavetypes')
            .select('leaveTypeName')
            .eq('leaveTypeId', leaveTypeId)
            .single();
            
        if (error || !data) {
            console.log('Error getting leave type name:', error);
            return 'Leave';
        }
        
        return data.leaveTypeName || 'Leave';
    } catch (err) {
        console.error('Error in getLeaveTypeName:', err);
        return 'Leave';
    }
}
function isValidQuarter(quarter) {
    return ['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter);
}

// Helper function to calculate progression insights
function calculateProgressionInsights(allFeedbackItems) {
    const insights = {
        improved: [],
        maintained: [],
        declined: [],
        newInSecondHalf: [],
        summary: {
            totalImproved: 0,
            totalDeclined: 0,
            averageImprovement: 0
        }
    };
    
    allFeedbackItems.forEach(item => {
        const q1q2Quarters = ['Q1', 'Q2'].filter(q => item.quarterRatings[q]);
        const q3q4Quarters = ['Q3', 'Q4'].filter(q => item.quarterRatings[q]);
        
        if (q1q2Quarters.length > 0 && q3q4Quarters.length > 0) {
            // Calculate average for first half and second half
            const firstHalfAvg = q1q2Quarters.reduce((sum, q) => sum + item.quarterRatings[q], 0) / q1q2Quarters.length;
            const secondHalfAvg = q3q4Quarters.reduce((sum, q) => sum + item.quarterRatings[q], 0) / q3q4Quarters.length;
            
            const improvement = secondHalfAvg - firstHalfAvg;
            
            if (Math.abs(improvement) < 0.2) {
                insights.maintained.push({
                    ...item,
                    firstHalfAvg,
                    secondHalfAvg,
                    improvement: 0
                });
            } else if (improvement > 0) {
                insights.improved.push({
                    ...item,
                    firstHalfAvg,
                    secondHalfAvg,
                    improvement
                });
                insights.summary.totalImproved++;
            } else {
                insights.declined.push({
                    ...item,
                    firstHalfAvg,
                    secondHalfAvg,
                    improvement
                });
                insights.summary.totalDeclined++;
            }
        } else if (q3q4Quarters.length > 0 && q1q2Quarters.length === 0) {
            // New skills/objectives introduced in second half
            insights.newInSecondHalf.push(item);
        }
    });
    
    // Calculate average improvement
    const totalImprovements = [...insights.improved, ...insights.declined].map(item => item.improvement);
    insights.summary.averageImprovement = totalImprovements.length > 0 ? 
        totalImprovements.reduce((sum, imp) => sum + imp, 0) / totalImprovements.length : 0;
    
    return insights;
}

const lineManagerController = {
    

    //TODO: should display all approved leave requests of the day - current sol here is not the current date
    // ++ should arrange this part by respective department 
    getLineManagerDashboard: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
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
                        userId: leave.userId,
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
                            city,
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
    
                // Fetch applicant statuses for line manager actions
                const fetchPendingApprovals = async () => {
                    const { data, error } = await supabase
                        .from('applicantaccounts')
                        .select('applicantStatus')
                        .eq('applicantStatus', 'P1 - Awaiting for Line Manager Action; HR PASSED');
    
                    if (error) throw error;
    
                    return data.length > 0 ? 'P1 - Awaiting for Line Manager Action; HR PASSED' : null;
                };
    
                // ✅ Fetch notifications
                const fetchNotifications = async () => {
                    const { data: applicants, error } = await supabase
                        .from('applicantaccounts')
                        .select('firstName, lastName, applicantStatus, created_at')
                        .order('created_at', { ascending: false });
    
                    if (error) {
                        console.error('Error fetching notifications:', error);
                        throw new Error('Error retrieving notifications.');
                    }
    
                    return applicants.map(applicant => ({
                        firstName: applicant.firstName,
                        lastName: applicant.lastName,
                        applicantStatus: applicant.applicantStatus,
                        date: applicant.created_at,
                        employeePhoto: "/images/profile.png", // Placeholder image
                        headline: applicant.applicantStatus === "P1 - Awaiting for Line Manager Action; HR PASSED"
                            ? "Awaiting Your Approval"
                            : "New Application Received",
                        content: applicant.applicantStatus === "P1 - Awaiting for Line Manager Action; HR PASSED"
                            ? `Required Line Manager Action for ${applicant.firstName} ${applicant.lastName}`
                            : `${applicant.firstName} ${applicant.lastName} submitted an application.`
                    }));
                };
    
                // Function to format attendance logs
                const formatAttendanceLogs = (attendanceLogs, selectedDate = null) => {
                    const filterDate = selectedDate || new Date().toISOString().split('T')[0];
                
                    const formattedAttendanceLogs = attendanceLogs
                        .filter(attendance => attendance.attendanceDate === filterDate) 
                        .reduce((acc, attendance) => {
                            const attendanceDate = attendance.attendanceDate;
                            const attendanceTime = attendance.attendanceTime || '00:00:00';
                            const [hours, minutes, seconds] = attendanceTime.split(':').map(Number);
                            const localDate = new Date(attendanceDate);
                            localDate.setHours(hours, minutes, seconds);
                
                            const userId = attendance.userId;
                            const existingEntry = acc.find(log => log.userId === userId && log.date === attendanceDate);
                            const city = attendance.city || 'N/A'
                
                            if (attendance.attendanceAction === 'Time In') {
                                if (existingEntry) {
                                    existingEntry.timeIn = localDate;
                                } else {
                                    acc.push({
                                        userId,
                                        date: attendanceDate,
                                        timeIn: localDate,
                                        timeOut: null,
                                        city,
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
                                        city,
                                        useraccounts: attendance.useraccounts
                                    });
                                }
                            }
                
                            return acc;
                        }, []);
                
                    return formattedAttendanceLogs.map(log => {
                        let activeWorkingHours = 0;
                        let timeOutMessage = '';
                        const now = new Date();
                
                        if (log.timeIn) {
                            const endOfDay = new Date(log.date);
                            endOfDay.setHours(23, 59, 59, 999); // End of the day
                            const endTime = log.timeOut || now;
                
                            if (!log.timeOut && endTime <= endOfDay) {
                                timeOutMessage = `(In Work)`;
                                activeWorkingHours = (endTime - log.timeIn) / 3600000; // Calculate hours
                            } else if (!log.timeOut && endTime > endOfDay) {
                                timeOutMessage = `(User did not Record Time Out)`;
                                activeWorkingHours = (endOfDay - log.timeIn) / 3600000; // Up to end of day
                            } else {
                                activeWorkingHours = (log.timeOut - log.timeIn) / 3600000; // Normal calculation
                            }
                        }
                
                        return {
                            department: log.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
                            firstName: log.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
                            lastName: log.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
                            jobTitle: log.useraccounts?.staffaccounts[0]?.jobpositions?.jobTitle || 'N/A',
                            date: log.timeIn ? new Date(log.timeIn).toISOString().split('T')[0] : 'N/A',
                            timeIn: log.timeIn ? log.timeIn.toLocaleTimeString() : 'N/A',
                            timeOut: log.timeOut ? log.timeOut.toLocaleTimeString() : timeOutMessage,
                            city: log.city || 'N/A',
                            activeWorkingHours: activeWorkingHours.toFixed(2)
                        };
                    });
                };
    
                // ✅ Fetch data
                const formattedAllLeaves = await fetchAndFormatLeaves();
                const formattedApprovedLeaves = await fetchAndFormatLeaves('Approved');
                const attendanceLogs = await fetchAttendanceLogs();
                const pendingApprovalStatus = await fetchPendingApprovals();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
                const notifications = await fetchNotifications(); // ✅ Notifications
    
                // ✅ Render with notifications
                return res.render('staffpages/linemanager_pages/managerdashboard', { 
                    allLeaves: formattedAllLeaves || [],
                    approvedLeaves: formattedApprovedLeaves || [],
                    pendingApprovalStatus: pendingApprovalStatus || '',
                    attendanceLogs: formattedAttendanceDisplay || [],
                    notifications: notifications || [], 
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors')
                });
    
            } catch (err) {
                console.error('Error fetching data for the dashboard:', err);
                req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
                return res.redirect('/linemanager/dashboard');
            }
        } else {
            return res.redirect('/staff/login');
        }
    },

    
    
getLeaveRequest: async function(req, res) {
    const leaveRequestId = req.query.leaveRequestId;
    const userId = req.query.userId;

    console.log('Incoming request query:', req.query);
    
    if (!userId && !leaveRequestId) {
        return res.status(400).json({ success: false, message: 'Either User ID or Leave Request ID is required.' });
    }

    try {
        let leaveRequest;
        let error;

        // If we have a leaveRequestId, use it for direct access to the specific request
        if (leaveRequestId) {
            console.log('Fetching by Leave Request ID:', leaveRequestId);
            
            const result = await supabase
                .from('leaverequests')
                .select(`
                    leaveRequestId,
                    userId,
                    fromDate,
                    fromDayType,
                    untilDate,
                    untilDayType,
                    reason,
                    leaveTypeId,
                    certificationPath,
                    isSelfCertified,
                    status,
                    useraccounts (
                        userId,
                        staffaccounts (
                            staffId,
                            lastName,
                            firstName,
                            phoneNumber
                        )
                    ),
                    leave_types (
                        typeName
                    )
                `)
                .eq('leaveRequestId', leaveRequestId)
                .single();
                
            leaveRequest = result.data;
            error = result.error;
        } 
        // If no leaveRequestId or the above query failed, fall back to userId (old behavior)
        if (!leaveRequest && userId) {
            console.log('Falling back to User ID:', userId);
            
            const result = await supabase
                .from('leaverequests')
                .select(`
                    leaveRequestId,
                    userId,
                    fromDate,
                    fromDayType,
                    untilDate,
                    untilDayType,
                    reason,
                    leaveTypeId,
                    certificationPath,
                    isSelfCertified,
                    status,
                    useraccounts (
                        userId,
                        staffaccounts (
                            staffId,
                            lastName,
                            firstName,
                            phoneNumber
                        )
                    ),
                    leave_types (
                        typeName
                    )
                `)
                .eq('userId', userId)
                .eq('status', 'Pending for Approval') // Prioritize pending requests
                .order('created_at', { ascending: false });
                
            if (result.data && result.data.length > 0) {
                leaveRequest = result.data[0]; // Take the first/most recent one
                console.log('Found leave request by userId:', leaveRequest.leaveRequestId);
            } else {
                error = result.error || { message: 'No leave requests found for this user' };
            }
        }

        if (error) {
            console.error('Error details:', error);
            return res.status(404).json({ success: false, message: 'Leave request not found.' });
        }

        if (!leaveRequest) {
            return res.status(404).json({ success: false, message: 'No leave request found.' });
        }
        
        // Format the data
        const formattedLeaveRequest = {
            leaveRequestId: leaveRequest.leaveRequestId,
            userId: leaveRequest.userId,
            fromDate: leaveRequest.fromDate,
            fromDayType: leaveRequest.fromDayType,
            untilDate: leaveRequest.untilDate,
            untilDayType: leaveRequest.untilDayType,
            reason: leaveRequest.reason,
            leaveTypeId: leaveRequest.leaveTypeId,
            leaveTypeName: leaveRequest.leave_types.typeName,
            certificationPath: leaveRequest.certificationPath || null,
            isSelfCertified: leaveRequest.isSelfCertified || false,
            status: leaveRequest.status || 'Pending for Approval',
            staff: {
                lastName: leaveRequest.useraccounts.staffaccounts[0]?.lastName || 'N/A',
                firstName: leaveRequest.useraccounts.staffaccounts[0]?.firstName || 'N/A',
                phoneNumber: leaveRequest.useraccounts.staffaccounts[0]?.phoneNumber || 'N/A'
            }
        };
        
        // Render the template with the formatted data
        return res.render('staffpages/linemanager_pages/managerviewleaverequests', { leaveRequest: formattedLeaveRequest });

    } catch (err) {
        console.error('Error fetching leave request:', err);
        return res.status(500).json({ success: false, message: 'Error fetching leave request.' });
    }
},
        
getTrainingDevelopmentTracker: async function (req, res) {
    try {
        console.log('Loading training development tracker...');

        // Fetch all active training courses (no joins)
        const { data: trainings, error: trainingsError } = await supabase
            .from('trainings')
            .select('*')
            .eq('isActive', true)
            .order('trainingName', { ascending: true });

        if (trainingsError) {
            console.error('Error fetching trainings:', trainingsError);
            throw trainingsError;
        }

        console.log(`Found ${trainings?.length || 0} training courses`);

        // Fetch job positions (no joins)
        const { data: jobPositions, error: jobsError } = await supabase
            .from('jobpositions')
            .select('*');

        if (jobsError) {
            console.error('Error fetching job positions:', jobsError);
        } else {
            console.log(`Found ${jobPositions?.length || 0} job positions`);
            console.log('Job positions structure:', jobPositions?.[0]);
        }

        // Fetch departments (no joins) 
        const { data: departments, error: departmentsError } = await supabase
            .from('departments')
            .select('*');

        if (departmentsError) {
            console.error('Error fetching departments:', departmentsError);
        } else {
            console.log(`Found ${departments?.length || 0} departments`);
            console.log('Departments structure:', departments?.[0]);
        }

        // Fetch some employees for sample data
        const { data: employees, error: employeesError } = await supabase
            .from('staffaccounts')
            .select('*');
            //.limit(20); // Get more employees to ensure we have the ones referenced by trainings

        if (employeesError) {
            console.error('Error fetching employees:', employeesError);
        } else {
            console.log(`Found ${employees?.length || 0} employees`);
            console.log('Employee structure:', employees?.[0]);
        }

        // Create lookup map for employees/staff
        const employeesMap = (employees || []).reduce((acc, employee) => {
            const empId = employee.staffId || employee.staff_id || employee.userId || employee.user_id || employee.id;
            const firstName = employee.staffFName || employee.staff_fname || employee.first_name || employee.firstName || 'Unknown';
            const lastName = employee.staffLName || employee.staff_lname || employee.last_name || employee.lastName || 'User';
            const email = employee.staffEmail || employee.staff_email || employee.email || 'no-email@company.com';
            const jobId = employee.jobId || employee.job_id;
            
            acc[empId] = {
                ...employee,
                id: empId,
                firstName: firstName,
                lastName: lastName,
                fullName: `${firstName} ${lastName}`,
                email: email,
                jobId: jobId
            };
            return acc;
        }, {});

        // Create lookup maps (handle different possible column names)
        const jobsMap = (jobPositions || []).reduce((acc, job) => {
            const jobId = job.jobId || job.job_id || job.id;
            acc[jobId] = {
                ...job,
                title: job.jobTitle || job.job_title || job.title || job.name || 'Unknown Position',
                description: job.jobDescrpt || job.job_description || job.description || '',
                departmentId: job.departmentId || job.department_id || job.dept_id
            };
            return acc;
        }, {});

        const departmentsMap = (departments || []).reduce((acc, dept) => {
            const deptId = dept.departmentId || dept.department_id || dept.dept_id || dept.id;
            const deptName = dept.departmentName || dept.department_name || dept.dept_name || dept.name || dept.title || 'Unknown Department';
            
            acc[deptId] = {
                ...dept,
                name: deptName
            };
            return acc;
        }, {});

        // Transform training data for the frontend
        const formattedTrainings = (trainings || []).map(training => {
            const job = jobsMap[training.jobId] || {};
            const department = departmentsMap[job.departmentId] || {};
            const trainingOwner = employeesMap[training.userId] || {};
            
            return {
                id: training.trainingId,
                title: training.trainingName || 'Untitled Training',
                description: training.trainingDesc || 'No description available',
                mode: training.isOnlineArrangement ? 'online' : 'onsite',
                location: training.isOnlineArrangement ? null : {
                    country: training.country,
                    address: training.address
                },
                cost: training.cost || 0,
                duration: training.totalDuration || 0,
                department: department.name || 'Unknown Department',
                jobTitle: job.title || 'Unknown Position',
                createdBy: trainingOwner.fullName || 'Unknown Creator',
                createdByEmail: trainingOwner.email || '',
                badges: [
                    training.isOnlineArrangement ? 'online' : 'onsite'
                ]
            };
        });

        // NEW: Create suggested trainings list with jobId for filtering
        const suggestedTrainings = (trainings || []).map(training => ({
            id: training.trainingId,
            name: training.trainingName || 'Untitled Training',
            description: training.trainingDesc || 'No description available',
            jobId: training.jobId, // IMPORTANT: Keep the jobId for filtering
            jobTitle: jobsMap[training.jobId]?.title || 'Unknown Position',
            department: departmentsMap[jobsMap[training.jobId]?.departmentId]?.name || 'Unknown Department',
            mode: training.isOnlineArrangement ? 'online' : 'onsite',
            cost: training.cost || 0,
            duration: training.totalDuration || 0,
            isActive: training.isActive,
            createdDate: training.createdAt || training.created_at,
            location: training.isOnlineArrangement ? null : {
                country: training.country,
                address: training.address
            }
        }));

        // Group suggested trainings by jobId for easier frontend filtering
        const suggestedTrainingsByJob = suggestedTrainings.reduce((acc, training) => {
            if (!acc[training.jobId]) {
                acc[training.jobId] = [];
            }
            acc[training.jobId].push(training);
            return acc;
        }, {});

        console.log(`Created ${suggestedTrainings.length} suggested trainings grouped by job position`);
        console.log('Trainings per job:', Object.keys(suggestedTrainingsByJob).map(jobId => ({
            jobId,
            jobTitle: jobsMap[jobId]?.title || 'Unknown',
            count: suggestedTrainingsByJob[jobId].length
        })));

        // Create employee list showing all employees (with or without training assignments)
        let employeeAssignments = [];
        
        if (employees && employees.length > 0) {
            console.log(`Creating assignments for ${employees.length} employees`);
            
            employeeAssignments = employees.map((employee, index) => {
                const empId = employee.staffId || employee.staff_id || employee.userId || employee.user_id || employee.id;
                const firstName = employee.staffFName || employee.staff_fname || employee.first_name || employee.firstName || 'Unknown';
                const lastName = employee.staffLName || employee.staff_lname || employee.last_name || employee.lastName || 'User';
                const email = employee.staffEmail || employee.staff_email || employee.email || 'no-email@company.com';
                const jobId = employee.jobId || employee.job_id;
                
                const job = jobsMap[jobId] || {};
                
                // Find if this employee has any training assigned (from trainings table)
                const assignedTraining = trainings?.find(training => training.userId === empId);
                
                if (assignedTraining) {
                    // Employee has training assigned
                    const progressOptions = [
                        { status: 'in-progress', progress: Math.floor(Math.random() * 80) + 10 },
                        { status: 'completed', progress: 100 },
                        { status: 'not-started', progress: Math.floor(Math.random() * 30) }
                    ];
                    const randomProgress = progressOptions[Math.floor(Math.random() * progressOptions.length)];

                    return {
                        employeeId: empId,
                        employeeName: `${firstName} ${lastName}`,
                        employeeEmail: email,
                        jobTitle: job.title || 'Unknown Position',
                        trainingTitle: assignedTraining.trainingName,
                        trainingId: assignedTraining.trainingId,
                        status: randomProgress.status,
                        progress: randomProgress.progress,
                        startDate: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000),
                        dueDate: new Date(Date.now() + Math.floor(Math.random() * 60) * 24 * 60 * 60 * 1000),
                        hasTraining: true
                    };
                } else {
                    // Employee has no training assigned
                    return {
                        employeeId: empId,
                        employeeName: `${firstName} ${lastName}`,
                        employeeEmail: email,
                        jobTitle: job.title || 'Unknown Position',
                        trainingTitle: 'No Training Assigned',
                        trainingId: null,
                        status: 'no-training',
                        progress: 0,
                        startDate: null,
                        dueDate: null,
                        hasTraining: false
                    };
                }
            });
        } else {
            console.log('No employees found, creating demo employee list');
            // Create demo employees if no real employees found
            employeeAssignments = [
                {
                    employeeId: 'demo-1',
                    employeeName: 'John Doe',
                    employeeEmail: 'john.doe@company.com',
                    jobTitle: 'Software Engineer',
                    trainingTitle: 'No Training Assigned',
                    trainingId: null,
                    status: 'no-training',
                    progress: 0,
                    startDate: null,
                    dueDate: null,
                    hasTraining: false
                },
                {
                    employeeId: 'demo-2',
                    employeeName: 'Jane Smith',
                    employeeEmail: 'jane.smith@company.com',
                    jobTitle: 'Operations Manager',
                    trainingTitle: 'No Training Assigned',
                    trainingId: null,
                    status: 'no-training',
                    progress: 0,
                    startDate: null,
                    dueDate: null,
                    hasTraining: false
                },
                {
                    employeeId: 'demo-3',
                    employeeName: 'Mike Johnson',
                    employeeEmail: 'mike.johnson@company.com',
                    jobTitle: 'Data Analyst',
                    trainingTitle: 'No Training Assigned',
                    trainingId: null,
                    status: 'no-training',
                    progress: 0,
                    startDate: null,
                    dueDate: null,
                    hasTraining: false
                }
            ];
        }

        console.log('Final employee assignments:', employeeAssignments);
        console.log(`Total employees: ${employeeAssignments.length}`);
        console.log(`Employees with training: ${employeeAssignments.filter(e => e.hasTraining).length}`);
        console.log(`Employees without training: ${employeeAssignments.filter(e => !e.hasTraining).length}`);

        // Get summary statistics
        const stats = {
            totalTrainings: formattedTrainings.length,
            onlineTrainings: formattedTrainings.filter(t => t.mode === 'online').length,
            onsiteTrainings: formattedTrainings.filter(t => t.mode === 'onsite').length,
            totalAssignments: employeeAssignments.length,
            inProgressAssignments: employeeAssignments.filter(a => a.status === 'in-progress').length,
            completedAssignments: employeeAssignments.filter(a => a.status === 'completed').length,
            overdueAssignments: employeeAssignments.filter(a => a.status === 'not-started' && new Date(a.dueDate) < new Date()).length,
            // NEW: Add suggested trainings stats
            totalSuggestedTrainings: suggestedTrainings.length,
            jobsWithTrainings: Object.keys(suggestedTrainingsByJob).length,
            avgTrainingsPerJob: Object.keys(suggestedTrainingsByJob).length > 0 ? 
                (suggestedTrainings.length / Object.keys(suggestedTrainingsByJob).length).toFixed(1) : 0
        };

        console.log('Final data summary:', {
            trainings: formattedTrainings.length,
            assignments: employeeAssignments.length,
            suggestedTrainings: suggestedTrainings.length,
            jobsWithTrainings: Object.keys(suggestedTrainingsByJob).length,
            stats
        });

        // Log detailed breakdown by job
        console.log('Detailed breakdown by job position:');
        Object.entries(suggestedTrainingsByJob).forEach(([jobId, trainings]) => {
            const job = jobsMap[jobId];
            console.log(`- ${job?.title || 'Unknown Job'} (ID: ${jobId}): ${trainings.length} trainings`);
            trainings.forEach(training => {
                console.log(`  * ${training.name} (${training.mode}, $${training.cost})`);
            });
        });

        // Render the training development tracker page with data
        res.render('staffpages/linemanager_pages/trainingdevelopmenttracker', {
            title: 'Employee Training & Development Tracker',
            trainings: formattedTrainings,
            assignments: employeeAssignments,
            suggestedTrainings: suggestedTrainings, // Full list for JavaScript filtering
            suggestedTrainingsByJob: suggestedTrainingsByJob, // Grouped by job for easier access
            jobPositions: jobPositions || [], // Pass job positions for reference
            departments: departments || [], // Pass departments for reference
            stats: stats,
            user: req.user || null,
            currentDate: new Date().toISOString(),
            formatDate: (date) => {
                return new Date(date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            },
            // Helper function for debugging in template
            debugMode: process.env.NODE_ENV === 'development'
        });
        
    } catch (error) {
        console.error('Error loading training development tracker:', error);
        
        // Enhanced error logging
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            details: error.details
        });
        
        res.status(500).send(`
            <h1>Error Loading Training Tracker</h1>
            <p>There was an error loading the training development tracker.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3>Error Details:</h3>
                <pre style="background: #e9ecef; padding: 10px; border-radius: 3px; overflow-x: auto;">
${process.env.NODE_ENV === 'development' ? 
    `Message: ${error.message}\n\nStack: ${error.stack}` : 
    'Internal Server Error - Check server logs for details'
}
                </pre>
            </div>
            <div style="margin-top: 20px;">
                <a href="/linemanager/dashboard" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                    ← Return to Dashboard
                </a>
                <button onclick="window.location.reload()" style="background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 5px; margin-left: 10px; cursor: pointer;">
                    🔄 Retry
                </button>
            </div>
        `);
    }
},

getTrainingObjectives: async function(req, res) {
    try {
        const trainingId = req.params.trainingId;
        
        // Get objectives for this training
        const { data: trainingObjectives, error } = await supabase
            .from('training_objectives')
            .select(`
                objectiveId,
                objectivesettings_objectives(objectiveDescrpt)
            `)
            .eq('trainingId', trainingId);

        if (error) {
            console.error('Error fetching training objectives:', error);
            return res.json({ success: false, message: 'Error fetching objectives' });
        }

        // Format the objectives
        const objectives = (trainingObjectives || []).map(item => ({
            id: item.objectiveId,
            description: item.objectivesettings_objectives?.objectiveDescrpt || 'No description'
        }));

        res.json({ 
            success: true, 
            objectives: objectives 
        });

    } catch (error) {
        console.error('Error in getTrainingObjectives:', error);
        res.json({ success: false, message: 'Server error' });
    }
},

getTrainingSkills: async function(req, res) {
    try {
        const trainingId = req.params.trainingId;
        
        // Get skills for this training
        const { data: trainingSkills, error } = await supabase
            .from('training_skills')
            .select(`
                jobReqSkillId,
                jobreqskills(jobReqSkillName, jobReqSkillType)
            `)
            .eq('trainingId', trainingId);

        if (error) {
            console.error('Error fetching training skills:', error);
            return res.json({ success: false, message: 'Error fetching skills' });
        }

        // Format the skills
        const skills = (trainingSkills || []).map(item => ({
            id: item.jobReqSkillId,
            name: item.jobreqskills?.jobReqSkillName || 'Unknown Skill',
            type: item.jobreqskills?.jobReqSkillType || 'Unknown Type'
        }));

        res.json({ 
            success: true, 
            skills: skills 
        });

    } catch (error) {
        console.error('Error in getTrainingSkills:', error);
        res.json({ success: false, message: 'Server error' });
    }
},

updateLeaveRequest: async function(req, res) {
    const leaveRequestId = req.body.leaveRequestId || req.query.leaveRequestId;
    const { action, remarks } = req.body;

    console.log('Incoming update request body:', req.body);
    console.log('leaveRequestId:', leaveRequestId);
    console.log('Action:', action);

    if (!leaveRequestId) {
        console.error('Error: leaveRequestId is missing');
        return res.status(400).json({ success: false, message: 'Leave Request ID is required.' });
    }
    if (!action) {
        console.error('Error: action is missing');
        return res.status(400).json({ success: false, message: 'Action is required.' });
    }
    
    try {
        // First, get the leave request details to access leaveTypeId, userId, and dates
        const { data: leaveRequest, error: fetchError } = await supabase
            .from('leaverequests')
            .select('*,leave_types(typeName)')
            .eq('leaveRequestId', leaveRequestId)
            .single();
            
        if (fetchError || !leaveRequest) {
            console.error('Error fetching leave request details:', fetchError);
            return res.status(404).json({ 
                success: false, 
                message: 'Leave request not found or error retrieving details'
            });
        }
        
        console.log('Retrieved leave request details:', leaveRequest);
        
        // Prepare the updated data based on action
        const updatedData = {
            remarkByManager: remarks,
            updatedDate: new Date(),
            status: action === 'approve' ? 'Approved' : 'Rejected'
        };

        // Log the prepared update data
        console.log('Updating leave request with data:', updatedData);

        // Update the leave request in the Supabase database
        const { data, error } = await supabase
            .from('leaverequests')
            .update(updatedData)
            .eq('leaveRequestId', leaveRequestId);

        // Check for errors in the update operation
        if (error) {
            console.error('Error details while updating leave request:', error);
            return res.status(400).json({ 
                success: false, 
                message: 'Failed to update leave request', 
                error 
            });
        }

        // Only update leave balances if the request is APPROVED
        if (action === 'approve') {
            // Calculate days between fromDate and untilDate
            const fromDateObj = new Date(leaveRequest.fromDate);
            const untilDateObj = new Date(leaveRequest.untilDate);
            
            // Calculate full days between dates (inclusive)
            let daysRequested = Math.ceil((untilDateObj - fromDateObj) / (1000 * 60 * 60 * 24)) + 1;
            
            // Adjust for half days if specified
            if (leaveRequest.fromDayType === 'half_day') {
                daysRequested -= 0.5;
            }
            if (leaveRequest.untilDayType === 'half_day') {
                daysRequested -= 0.5;
            }
            
            console.log(`Leave duration calculated: ${daysRequested} days`);
            
            // Get current leave balance for this user and leave type
            const { data: balanceData, error: balanceError } = await supabase
                .from('leavebalances')
                .select('usedLeaves, remainingLeaves, totalLeaves')
                .eq('userId', leaveRequest.userId)
                .eq('leaveTypeId', leaveRequest.leaveTypeId)
                .single();
                
            if (balanceError) {
                console.error('Error fetching leave balance:', balanceError);
                // Continue with the process even if there's an error here
            }
            
            // Default values if no balance record exists
            let currentUsedLeaves = 0;
            let currentRemainingLeaves = 0; 
            let totalLeaves = 0;
            
            if (balanceData) {
                currentUsedLeaves = balanceData.usedLeaves || 0;
                currentRemainingLeaves = balanceData.remainingLeaves || 0;
                totalLeaves = balanceData.totalLeaves || 0;
            }
            
            // Calculate new balances
            const newUsedLeaves = currentUsedLeaves + daysRequested;
            const newRemainingLeaves = Math.max(0, currentRemainingLeaves - daysRequested);
            
            console.log(`Updating leave balance: Used: ${currentUsedLeaves} -> ${newUsedLeaves}, Remaining: ${currentRemainingLeaves} -> ${newRemainingLeaves}`);
            
            // Update the leave balance record
            const { error: upsertError } = await supabase
                .from('leavebalances')
                .upsert({
                    userId: leaveRequest.userId,
                    leaveTypeId: leaveRequest.leaveTypeId,
                    usedLeaves: newUsedLeaves,
                    remainingLeaves: newRemainingLeaves,
                    totalLeaves: totalLeaves || (newUsedLeaves + newRemainingLeaves) // Preserve total if exists
                });
                
            if (upsertError) {
                console.error('Error updating leave balance:', upsertError);
                // Don't return an error, just log it and continue
            } else {
                console.log('Successfully updated leave balance');
            }
        } else {
            console.log('Leave request rejected, no changes to leave balance');
        }

        // Log the successful update
        console.log('Leave request updated successfully:', data);

        return res.redirect('/linemanager/dashboard'); 
    } catch (error) {
        console.error('Error updating leave request:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Server error. Please try again later.' 
        });
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

        // Fetch offboarding requests for this user
        const { data: offboardingRequests, error: offboardingError } = await supabase
            .from('offboarding_requests')
            .select('*')
            .eq('userId', userId)
            .order('created_at', { ascending: false });

        if (offboardingError) {
            console.error('Error fetching offboarding requests:', offboardingError);
            // Don't redirect, just log the error and continue
        }

        const userData = {
            ...user,
            firstName: staff.firstName,
            lastName: staff.lastName,
            deptName: staff.departments.deptName,
            jobTitle: staff.jobpositions.jobTitle
        };

        res.render('staffpages/employee_pages/useracc', { 
            user: userData,
            offboardingRequests: offboardingRequests || [] // Pass empty array if null
        });
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
                return res.redirect('staffpages/linemanager_pages/manageruseraccount');
            }

            req.flash('success', 'User information updated successfully!');
            res.redirect('staffpages/linemanager_pages/manageruseraccount');
        } catch (err) {
            console.error('Error in updateUserInfo controller:', err);
            req.flash('errors', { dbError: 'An error occurred while updating the information.' });
            res.redirect('staffpages/linemanager_pages/manageruseraccount')
        }
    },

    getInterviewBookings: function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            res.render('staffpages/linemanager_pages/linemanagerinterviewbookings', {
                user: req.session.user // Passes user data from session to the page
            });
        } catch (err) {
            console.error('Error in getInterviewBookings controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/linemanager/dashboard');
        }
    },

    getInterviewBookingss: function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            if (!userId) {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            res.render('staffpages/linemanager_pages/linemanagerinterviewbookingss', {
                user: req.session.user // Passes user data from session to the page
            });
        } catch (err) {
            console.error('Error in getInterviewBookings controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the page.' });
            res.redirect('/linemanager/dashboard');
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

    getMRF: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                // Fetch MRF data
                const { data: mrfList, error: mrfError } = await supabase
                    .from('mrf')
                    .select('positionTitle, requisitionDate, mrfId, status'); // include status in query
            
                if (mrfError) throw mrfError;
        
                // Fetch approval statuses
                const { data: approvals, error: approvalError } = await supabase
                    .from('mrf_approvals')
                    .select('mrfId, approval_stage');
        
                if (approvalError) throw approvalError;
        
                // Combine MRF data with approval statuses
                const combinedData = mrfList.map(mrf => {
                    const approval = approvals.find(a => a.mrfId === mrf.mrfId);
                    const status = approval ? approval.approval_stage : mrf.status || 'Pending'; // Default to 'Pending' if no approval data
                    return {
                        positionTitle: mrf.positionTitle,
                        requisitionDate: mrf.requisitionDate,
                        status: status,
                        mrfId: mrf.mrfId
                    };
                });
        
                res.render('staffpages/linemanager_pages/mrf', { mrfRequests: combinedData });
            } catch (error) {
                console.error("Error in getMRF:", error);
                req.flash('errors', { fetchError: 'Error fetching MRF data.' });
                res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getMRFList: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            MRFModel.find({}, (err, mrfList) => {
                if (err) {
                    req.flash('errors', { fetchError: 'Error fetching MRF list.' });
                }
                res.render('staffpages/linemanager_pages/mrf_list', { mrfList });
            });
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    // Updated getEvaluationForm function for lineManagerController.js

// Updated getEvaluationForm function with better parameter handling and debugging
getEvaluationForm: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        try {
            // Extract the applicantId from the URL parameters 
            const applicantId = req.params.applicantId;
            
            // Log all parameters for debugging
            console.log('All route parameters:', req.params);
            console.log('All query parameters:', req.query);
            console.log('Extracted applicantId:', applicantId);
            
            // Check if applicantId is valid
            if (!applicantId || applicantId === ':applicantId') {
                console.error('Invalid applicantId provided:', applicantId);
                req.flash('errors', { message: 'Invalid Applicant ID.' });
                return res.redirect('/linemanager/dashboard');
            }
            
            console.log('Attempting to fetch applicant with ID:', applicantId);
            
            // Fetch applicant data from the database
            const { data: applicant, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    userId,
                    firstName,
                    lastName,
                    phoneNo,
                    applicantStatus,
                    departmentId,
                    jobId
                `)
                .eq('applicantId', applicantId)
                .single();
                
            if (applicantError) {
                console.error('Error fetching applicant:', applicantError);
                req.flash('errors', { message: 'Error fetching applicant data.' });
                return res.redirect('/linemanager/dashboard');
            }
            
            if (!applicant) {
                console.error('No applicant found with ID:', applicantId);
                req.flash('errors', { message: 'Applicant not found.' });
                return res.redirect('/linemanager/dashboard');
            }
            
            console.log('Successfully fetched applicant:', applicant);
            
            // Fetch user email if possible
            const { data: userData, error: userError } = await supabase
                .from('useraccounts')
                .select('userEmail')
                .eq('userId', applicant.userId)
                .single();
                
            if (!userError && userData) {
                applicant.email = userData.userEmail;
            } else {
                applicant.email = 'Email not available';
            }
            
            // Fetch job title
            const { data: jobData, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobTitle')
                .eq('jobId', applicant.jobId)
                .single();
                
            if (!jobError && jobData) {
                applicant.jobTitle = jobData.jobTitle;
            } else {
                applicant.jobTitle = 'Job title not available';
            }
            
            // Fetch department name
            const { data: deptData, error: deptError } = await supabase
                .from('departments')
                .select('deptName')
                .eq('departmentId', applicant.departmentId)
                .single();
                
            if (!deptError && deptData) {
                applicant.department = deptData.deptName;
            } else {
                applicant.department = 'Department not available';
            }
            
            console.log('Rendering interview form with data:', { 
                applicantId: applicant.applicantId,
                name: `${applicant.firstName} ${applicant.lastName}`,
                email: applicant.email
            });
        
            // Render the interview form with the applicant data
            return res.render('staffpages/linemanager_pages/interview-form-linemanager', {
                applicant: applicant,
                user: req.session.user
            });
        } catch (error) {
            console.error('Error in getEvaluationForm:', error);
            req.flash('errors', { message: 'An error occurred while processing your request.' });
            return res.redirect('/linemanager/dashboard');
        }
    } 

    req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
    return res.redirect('/staff/login');
},
    
submitInterviewEvaluation: async function(req, res) {
    try {
        console.log('DEBUG [1]: Starting submitInterviewEvaluation function');
        
        // Extract form values
        let userId = req.body.userId;
        console.log('DEBUG [3]: Original userId from form:', userId);
        
        // Clean userId if it contains commas
        if (userId && typeof userId === 'string' && userId.includes(',')) {
            console.log('DEBUG [4]: Found comma in userId, cleaning value:', userId);
            userId = userId.replace(/,/g, '');
            console.log('DEBUG [5]: Cleaned userId:', userId);
        }
        
        const applicantId = req.params.applicantId || req.body.applicantId;
        const interviewDate = req.body.interviewDate || new Date().toISOString().split('T')[0];
        const lineManagerUserId = req.session.user.userId;
        
        console.log('DEBUG [6]: Processing with userId:', userId, 'applicantId:', applicantId);
        
        if (!userId) {
            console.error('DEBUG [7]: Missing userId - cannot proceed');
            req.flash('errors', { message: 'User ID is required' });
            return res.redirect('/linemanager/dashboard');
        }
        
        // Calculate ratings
        console.log('DEBUG [8]: Calculating ratings from form data');
        
        const personalReportRating = parseInt(req.body.personalReportRating || 0);
        const functionalJobRating = parseInt(req.body.functionalJobRating || 0);
        const instructionsRating = parseInt(req.body.instructionsRating || 0);
        const peopleRating = parseInt(req.body.peopleRating || 0);
        const writingRating = parseInt(req.body.writingRating || 0);
        
        const totalAssessmentRating = 
            personalReportRating + 
            functionalJobRating + 
            instructionsRating + 
            peopleRating + 
            writingRating;
            
        console.log('DEBUG [9]: Total assessment rating calculated:', totalAssessmentRating);
        
        // Get line manager staffId
        console.log('DEBUG [10]: Fetching line manager staffId');
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('staffId')
            .eq('userId', lineManagerUserId)
            .single();
            
        if (staffError || !staffData) {
            console.error('DEBUG [11]: Error fetching line manager staffId:', staffError);
            req.flash('errors', { message: 'Your account is not properly set up.' });
            return res.redirect('/linemanager/dashboard');
        }
        
        const managerStaffId = staffData.staffId;
        console.log('DEBUG [12]: Retrieved managerStaffId:', managerStaffId);
        
        // Create panel form data JSON
        console.log('DEBUG [13]: Preparing panel form data JSON');
        
        const panelFormData = JSON.stringify({
            interviewType: req.body.interviewType || 'Not specified',
            interviewDate: interviewDate,
            personalReport: {
                careerGoals: req.body.careerGoals || '',
                resumeWalkthrough: req.body.resumeWalkthrough || '',
                rating: personalReportRating
            },
            functionalJob: {
                situation: req.body.jobSituation || '',
                action: req.body.jobAction || '',
                result: req.body.jobResult || '',
                rating: functionalJobRating
            },
            instructions: {
                situation: req.body.instructionsSituation || '',
                action: req.body.instructionsAction || '',
                result: req.body.instructionsResult || '',
                rating: instructionsRating
            },
            people: {
                situation: req.body.peopleSituation || '',
                action: req.body.peopleAction || '',
                result: req.body.peopleResult || '',
                rating: peopleRating
            },
            writing: {
                situation: req.body.writingSituation || '',
                action: req.body.writingAction || '',
                result: req.body.writingResult || '',
                rating: writingRating
            },
            overall: {
                equipmentTools: req.body.equipmentTools || '',
                questionsCompany: req.body.questionsCompany || '',
                overallRating: req.body.overallRating || '0',
                recommendation: req.body.recommendation || ''
            }
        });
        
        console.log('DEBUG [14]: Successfully created panelFormData JSON');
        
        try {
            // Check the applicant table first to make sure the record exists
            console.log('DEBUG [15]: Verifying applicant exists with userId:', userId);
            const { data: checkApplicant, error: checkError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, userId, applicantStatus')
                .eq('userId', userId)
                .single();
                
            if (checkError) {
                console.error('DEBUG [16]: Error verifying applicant exists:', checkError);
                req.flash('errors', { message: 'Could not find applicant record with this User ID.' });
                return res.redirect('/linemanager/dashboard');
            }
            
            console.log('DEBUG [17]: Verified applicant exists. Current status:', checkApplicant.applicantStatus);
            
            // Insert the evaluation data
            console.log('DEBUG [18]: Inserting interview evaluation with applicantUserId:', applicantId);
            const { data: insertData, error: insertError } = await supabase
                .from('applicant_panelscreening_assessment')
                .insert({
                    applicantUserId: applicantId,
                    managerUserId: managerStaffId,
                    jobId: req.body.jobId,
                    interviewDate: interviewDate,
                    longTermGoalsRapport: req.body.careerGoals || '',
                    strengthsRapport: req.body.resumeWalkthrough || '',
                    panelFormData: panelFormData,
                    totalAssessmentRating: totalAssessmentRating,
                    equipmentToolsSoftware: req.body.equipmentTools || '',
                    remarks: req.body.remarksByInterviewer || '',
                    conclusion: req.body.recommendation || ''
                });
            
            if (insertError) {
                console.error('DEBUG [19]: Error inserting interview evaluation:', insertError);
                req.flash('errors', { message: 'Error saving interview evaluation' });
                return res.redirect('/linemanager/dashboard');
            }
            
            console.log('DEBUG [20]: Successfully inserted interview evaluation');
            
            // Update applicant status - FIXED: Removed non-existent columns
            console.log('DEBUG [21]: Now updating applicant status with userId:', userId);
            const { data: updateData, error: updateError } = await supabase
                .from('applicantaccounts')
                .update({ 
                    applicantStatus: 'P3 - Line Manager Evaluation Accomplished',
                    lineManagerInterviewDate: interviewDate
                    // Removed: lineManagerInterviewCompleted: true
                })
                .eq('userId', userId);
                
            if (updateError) {
                console.error('DEBUG [22]: Error updating applicant status:', updateError);
                
                // Try with just the status field if other fields fail
                console.log('DEBUG [23]: Trying fallback update with just the status field');
                const { data: fallbackData, error: fallbackError } = await supabase
                    .from('applicantaccounts')
                    .update({ 
                        applicantStatus: 'P3 - Line Manager Evaluation Accomplished'
                        // No other fields
                    })
                    .eq('userId', userId);
                    
                if (fallbackError) {
                    console.error('DEBUG [24]: Fallback update also failed:', fallbackError);
                    req.flash('errors', { message: 'The evaluation was saved, but there was an error updating the applicant status.' });
                    return res.redirect('/linemanager/applicant-tracker');
                } else {
                    console.log('DEBUG [25]: Fallback update succeeded');
                }
            }
            
            console.log('DEBUG [26]: Successfully updated applicant status to P3 - Line Manager Evaluation Accomplished');
            
            // Verify the status was updated
            console.log('DEBUG [27]: Verifying status update');
            const { data: verifyData, error: verifyError } = await supabase
                .from('applicantaccounts')
                .select('applicantStatus')
                .eq('userId', userId)
                .single();
                
            if (verifyError) {
                console.error('DEBUG [28]: Failed to verify status update:', verifyError);
            } else {
                console.log('DEBUG [29]: Verified new status:', verifyData.applicantStatus);
            }
            
            req.flash('success', 'Interview evaluation submitted successfully! The applicant status has been updated.');
            console.log('DEBUG [30]: Redirecting to applicant tracker');
            return res.redirect('/linemanager/applicant-tracker');
        } catch (error) {
            console.error('DEBUG [31]: Error during interview evaluation submission:', error);
            req.flash('errors', { message: 'An error occurred during submission. Please try again.' });
            return res.redirect('/linemanager/dashboard');
        }
        
    } catch (error) {
        console.error('DEBUG [32]: Uncaught error in submitInterviewEvaluation:', error);
        req.flash('errors', { message: 'An error occurred while processing the interview evaluation' });
        return res.redirect('/linemanager/dashboard');
    }
},

// Add this function to lineManagerController.js

/**
 * Send a job offer to an applicant and update their status
 */
// sendJobOffer: async function(req, res) {
//     console.log('========== SEND JOB OFFER DEBUG START ==========');
    
//     try {
//         // Log the entire request body
//         console.log('Full Request Body:', req.body);
        
//         const { applicantId, startDate, additionalNotes } = req.body;
        
//         // Detailed input validation logging
//         console.log('Extracted Values:');
//         console.log('Applicant ID:', applicantId);
//         console.log('Start Date:', startDate);
//         console.log('Additional Notes:', additionalNotes);
        
//         // Validate input with detailed logging
//         if (!applicantId) {
//             console.error('ERROR: Applicant ID is MISSING');
//             return res.status(400).json({ 
//                 success: false, 
//                 message: 'Applicant ID is required' 
//             });
//         }
        
//         if (!startDate) {
//             console.error('ERROR: Start Date is MISSING');
//             return res.status(400).json({ 
//                 success: false, 
//                 message: 'Start date is required' 
//             });
//         }
        
//         // Fetch current applicant details before update
//         const { data: currentApplicant, error: fetchError } = await supabase
//             .from('applicantaccounts')
//             .select('*')
//             .eq('applicantId', applicantId)
//             .single();
        
//         console.log('Current Applicant Details:', currentApplicant);
        
//         if (fetchError) {
//             console.error('ERROR Fetching Applicant:', fetchError);
//             return res.status(404).json({ 
//                 success: false, 
//                 message: 'Applicant not found',
//                 error: fetchError 
//             });
//         }
        
//         // Perform update with detailed logging
//         const { data, error } = await supabase
//             .from('applicantaccounts')
//             .update({ 
//                 applicantStatus: 'P3 - PASSED - Job Offer Sent',
//                 jobOfferSentDate: new Date().toISOString()
//             })
//             .eq('applicantId', applicantId);
        
//         // Log update results
//         console.log('Update Operation Results:');
//         console.log('Data:', data);
//         console.log('Error:', error);
        
//         if (error) {
//             console.error('DATABASE UPDATE ERROR:', error);
//             return res.status(500).json({ 
//                 success: false, 
//                 message: 'Failed to update applicant status',
//                 details: error 
//             });
//         }
        
//         // Verify the update by fetching the record again
//         const { data: updatedApplicant, error: verifyError } = await supabase
//             .from('applicantaccounts')
//             .select('*')
//             .eq('applicantId', applicantId)
//             .single();
        
//         console.log('Updated Applicant Verification:');
//         console.log('Updated Details:', updatedApplicant);
//         console.log('Verification Error:', verifyError);
        
//         // Final verification log
//         if (updatedApplicant) {
//             console.log('STATUS CHANGE VERIFICATION:');
//             console.log('Old Status:', currentApplicant?.applicantStatus);
//             console.log('New Status:', updatedApplicant.applicantStatus);
//         }
        
//         console.log('========== SEND JOB OFFER DEBUG END ==========');
        
//         // Return success response
//         return res.status(200).json({ 
//             success: true, 
//             message: 'Job offer sent successfully',
//             updatedStatus: updatedApplicant?.applicantStatus
//         });
        
//     } catch (error) {
//         console.error('CRITICAL ERROR in sendJobOffer:', error);
//         return res.status(500).json({ 
//             success: false, 
//             message: 'An unexpected error occurred',
//             errorDetails: error.message,
//             fullError: error
//         });
//     }
// },


sendJobOffer: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        try {
            const { applicantId, startDate, additionalNotes } = req.body;
            
            if (!applicantId || !startDate) {
                return res.status(400).json({ success: false, message: 'Missing required information' });
            }
            
            // Get the jobId from the applicant record
            const { data: applicantData, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select('jobId')
                .eq('applicantId', applicantId)
                .single();
                
            if (applicantError || !applicantData) {
                console.error('Error fetching applicant data:', applicantError);
                return res.status(500).json({ success: false, message: 'Failed to fetch applicant data' });
            }
            
            const jobId = applicantData.jobId;
            
            // Save the start date to the onboarding_position-startdate table
            const { error: startDateError } = await supabase
                .from('onboarding_position-startdate')
                .upsert({ 
                    jobId: jobId,
                    setStartDate: startDate,
                    updatedAt: new Date().toISOString(),
                    isAccepted: false, // Initialize as false until applicant accepts
                    additionalNotes: additionalNotes || ''
                });
                
            if (startDateError) {
                console.error('Error saving start date:', startDateError);
                return res.status(500).json({ success: false, message: 'Failed to save start date' });
            }
            
            // Update the applicant status
            const { error: updateError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - PASSED - Job Offer Sent' })
                .eq('applicantId', applicantId);
                
            if (updateError) {
                console.error('Error updating applicant status:', updateError);
                return res.status(500).json({ success: false, message: 'Failed to update applicant status' });
            }
            
            return res.json({ success: true, message: 'Job offer sent successfully' });
        } catch (error) {
            console.error('Error sending job offer:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    } else {
        return res.status(401).json({ success: false, message: 'Unauthorized access. Line Manager role required.' });
    }
},

/**
 * Gets the job offer details
 */
getJobOfferDetails: async function(req, res) {
    try {
        const { jobOfferId } = req.params;
        
        if (!jobOfferId) {
            req.flash('errors', { message: 'Job Offer ID is required' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Fetch the job offer details
        const { data: jobOffer, error: jobOfferError } = await supabase
            .from('job_offers')
            .select(`
                jobOfferId,
                applicantId,
                userId,
                position,
                department,
                startDate,
                employmentType,
                additionalDetails,
                status,
                sentDate,
                responseDate,
                acceptanceStatus
            `)
            .eq('jobOfferId', jobOfferId)
            .single();
            
        if (jobOfferError) {
            console.error('Error fetching job offer details:', jobOfferError);
            req.flash('errors', { message: 'Error fetching job offer details' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Fetch applicant details
        const { data: applicant, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                firstName,
                lastName,
                userEmail,
                phoneNo
            `)
            .eq('applicantId', jobOffer.applicantId)
            .single();
            
        if (applicantError) {
            console.error('Error fetching applicant details:', applicantError);
            req.flash('errors', { message: 'Error fetching applicant details' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Combine data for display
        const jobOfferDetails = {
            ...jobOffer,
            applicantName: `${applicant.firstName} ${applicant.lastName}`,
            applicantEmail: applicant.userEmail,
            applicantPhone: applicant.phoneNo,
            formattedSentDate: new Date(jobOffer.sentDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }),
            formattedResponseDate: jobOffer.responseDate ? new Date(jobOffer.responseDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }) : 'Pending Response',
            formattedStartDate: new Date(jobOffer.startDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
        };
        
        // Render job offer details view
        res.render('staffpages/linemanager_pages/job-offer-details', {
            jobOffer: jobOfferDetails
        });
        
    } catch (error) {
        console.error('Error in getJobOfferDetails:', error);
        req.flash('errors', { message: 'An error occurred while retrieving job offer details' });
        return res.redirect('/linemanager/applicant-tracker');
    }
},

// View the interview evaluation form
getViewInterviewForm: async function(req, res) {
    try {
        const applicantId = req.params.applicantId;
        
        if (!applicantId) {
            req.flash('errors', { message: 'Applicant ID is required' });
            return res.redirect('/linemanager/dashboard');
        }
        
        // Get the applicant details first
        const { data: applicant, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                userId,
                firstName,
                lastName,
                phoneNo,
                applicantStatus,
                departmentId,
                jobId
            `)
            .eq('applicantId', applicantId)
            .single();
        
        if (applicantError || !applicant) {
            console.error('Error fetching applicant:', applicantError);
            req.flash('errors', { message: 'Error fetching applicant data' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Get applicant email
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', applicant.userId)
            .single();
            
        // Get job and department info
        const { data: jobData, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', applicant.jobId)
            .single();
            
        const { data: deptData, error: deptError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', applicant.departmentId)
            .single();
        
        // Get the interview evaluation data
        const { data: interviewData, error: interviewError } = await supabase
            .from('applicant_panelscreening_assessment')
            .select('*')
            .eq('applicantUserId', applicantId)
            .order('interviewDate', { ascending: false })
            .limit(1)
            .single();
            
        if (interviewError || !interviewData) {
            console.error('Error fetching interview data:', interviewError);
            req.flash('errors', { message: 'Interview evaluation not found' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Enhance the applicant data with additional information
        const enhancedApplicant = {
            ...applicant,
            email: userData?.userEmail || 'N/A',
            jobTitle: jobData?.jobTitle || 'N/A',
            department: deptData?.deptName || 'N/A'
        };
        
        // Parse the JSON data
        const panelFormData = interviewData.panelFormData ? JSON.parse(interviewData.panelFormData) : {};
        
        // Prepare the full evaluation data for the view
        const evaluation = {
            applicant: enhancedApplicant,
            interviewDate: interviewData.interviewDate,
            interviewType: panelFormData.interviewType || 'Not specified',
            personalReport: panelFormData.personalReport || { 
                careerGoals: 'Not provided',
                resumeWalkthrough: 'Not provided',
                rating: 0
            },
            functionalJob: panelFormData.functionalJob || {
                situation: 'Not provided',
                action: 'Not provided',
                result: 'Not provided',
                rating: 0
            },
            instructions: panelFormData.instructions || {
                situation: 'Not provided',
                action: 'Not provided',
                result: 'Not provided',
                rating: 0
            },
            people: panelFormData.people || {
                situation: 'Not provided',
                action: 'Not provided',
                result: 'Not provided',
                rating: 0
            },
            writing: panelFormData.writing || {
                situation: 'Not provided',
                action: 'Not provided',
                result: 'Not provided',
                rating: 0
            },
            overall: panelFormData.overall || {
                overallRating: 0,
                recommendation: 'Not provided',
                questionsCompany: 'Not provided'
            },
            totalAssessmentRating: interviewData.totalAssessmentRating || 0,
            equipmentToolsSoftware: interviewData.equipmentToolsSoftware || 'Not provided',
            remarks: interviewData.remarks || 'No remarks provided'
        };
        
        // Render the view with the evaluation data
        res.render('staffpages/linemanager_pages/view-interview-form', { evaluation });
        
    } catch (error) {
        console.error('Error in getViewInterviewForm:', error);
        req.flash('errors', { message: 'An error occurred while retrieving the interview evaluation' });
        res.redirect('/linemanager/dashboard');
    }
},

// Pass the applicant after reviewing evaluation
passApplicant: async function(req, res) {
    try {
        const applicantId = req.params.applicantId;
        
        if (!applicantId) {
            req.flash('errors', { message: 'Applicant ID is required' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Update the applicant status to P3 - PASSED (removed updatedAt)
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: 'P3 - PASSED'
            })
            .eq('applicantId', applicantId);
            
        if (error) {
            console.error('Error updating applicant status:', error);
            req.flash('errors', { message: 'Error updating applicant status' });
            return res.redirect(`/linemanager/view-interview-form/${applicantId}`);
        }
        
        // Get applicant's userId for notification
        const { data: applicant, error: fetchError } = await supabase
            .from('applicantaccounts')
            .select('userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (!fetchError && applicant) {
            // Send notification to applicant via chatbot if available
            try {
                await supabase
                    .from('chatbot_history')
                    .insert({
                        userId: applicant.userId,
                        message: JSON.stringify({ 
                            text: "Congratulations! We are pleased to inform you that you have passed the Line Manager interview. You will be contacted soon with further information about the next steps in the hiring process." 
                        }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - PASSED'
                    });
            } catch (chatError) {
                console.error('Error sending chat notification:', chatError);
                // Continue processing even if notification fails
            }
        }
        
        req.flash('success', 'Applicant has been successfully marked as PASSED!');
        return res.redirect('/linemanager/applicant-tracker');
        
    } catch (error) {
        console.error('Error in passApplicant:', error);
        req.flash('errors', { message: 'An error occurred while updating the applicant status' });
        return res.redirect('/linemanager/applicant-tracker');
    }
},

// Reject the applicant after reviewing evaluation
rejectApplicant: async function(req, res) {
    try {
        const applicantId = req.params.applicantId;
        
        if (!applicantId) {
            req.flash('errors', { message: 'Applicant ID is required' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // If this is a form submission with rejection reason
        let rejectionReason = 'Not a good fit for the position';
        if (req.method === 'POST' && req.body.rejectionReason) {
            rejectionReason = req.body.rejectionReason;
        }
        
        // Update the applicant status to P3 - FAILED (removed updatedAt)
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: 'P3 - FAILED',
                rejectionReason: rejectionReason
            })
            .eq('applicantId', applicantId);
            
        if (error) {
            console.error('Error updating applicant status:', error);
            req.flash('errors', { message: 'Error updating applicant status' });
            return res.redirect(`/linemanager/view-interview-form/${applicantId}`);
        }
        
        // Get applicant's userId for notification
        const { data: applicant, error: fetchError } = await supabase
            .from('applicantaccounts')
            .select('userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (!fetchError && applicant) {
            // Send notification to applicant via chatbot if available
            try {
                await supabase
                    .from('chatbot_history')
                    .insert({
                        userId: applicant.userId,
                        message: JSON.stringify({ 
                            text: `Thank you for participating in our interview process. After careful consideration, we regret to inform you that we will not be proceeding with your application at this time. Reason: ${rejectionReason}`
                        }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - FAILED'
                    });
            } catch (chatError) {
                console.error('Error sending chat notification:', chatError);
                // Continue processing even if notification fails
            }
        }
        
        req.flash('success', 'Applicant has been marked as REJECTED and notified.');
        return res.redirect('/linemanager/applicant-tracker');
        
    } catch (error) {
        console.error('Error in rejectApplicant:', error);
        req.flash('errors', { message: 'An error occurred while updating the applicant status' });
        return res.redirect('/linemanager/applicant-tracker');
    }
},

// Handle API endpoints for pass/reject from the main applicant list
handlePassApplicant: async function(req, res) {
    const { applicantId } = req.body;
    
    try {
        if (!applicantId) {
            return res.status(400).json({ success: false, message: 'Applicant ID is required' });
        }
        
        // Update the applicant status to P3 - PASSED (removed updatedAt)
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: 'P3 - PASSED'
            })
            .eq('applicantId', applicantId);
            
        if (error) {
            console.error('Error updating applicant status:', error);
            return res.status(500).json({ success: false, message: 'Error updating applicant status' });
        }
        
        // Notification logic same as in passApplicant method
        // Get applicant's userId for notification
        const { data: applicant, error: fetchError } = await supabase
            .from('applicantaccounts')
            .select('userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (!fetchError && applicant) {
            // Send notification to applicant via chatbot if available
            try {
                await supabase
                    .from('chatbot_history')
                    .insert({
                        userId: applicant.userId,
                        message: JSON.stringify({ 
                            text: "Congratulations! We are pleased to inform you that you have passed the Line Manager interview. You will be contacted soon with further information about the next steps in the hiring process." 
                        }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - PASSED'
                    });
            } catch (chatError) {
                console.error('Error sending chat notification:', chatError);
                // Continue processing even if notification fails
            }
        }
        
        return res.status(200).json({ 
            success: true, 
            message: 'Applicant has been successfully marked as PASSED!',
            newStatus: 'P3 - PASSED'
        });
        
    } catch (error) {
        console.error('Error in handlePassApplicant:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while updating the applicant status'
        });
    }
},

// Handle API endpoints for reject from the main applicant list
handleRejectApplicant: async function(req, res) {
    const { applicantId, reason } = req.body;
    
    try {
        if (!applicantId) {
            return res.status(400).json({ success: false, message: 'Applicant ID is required' });
        }
        
        // Default reason if none provided
        const rejectionReason = reason || 'Not a good fit for the position';
        
        // Update the applicant status to P3 - FAILED (removed updatedAt)
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: 'P3 - FAILED',
                rejectionReason: rejectionReason
            })
            .eq('applicantId', applicantId);
            
        if (error) {
            console.error('Error updating applicant status:', error);
            return res.status(500).json({ success: false, message: 'Error updating applicant status' });
        }
        
        // Notification logic same as in rejectApplicant method
        // Get applicant's userId for notification
        const { data: applicant, error: fetchError } = await supabase
            .from('applicantaccounts')
            .select('userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (!fetchError && applicant) {
            // Send notification to applicant via chatbot if available
            try {
                await supabase
                    .from('chatbot_history')
                    .insert({
                        userId: applicant.userId,
                        message: JSON.stringify({ 
                            text: `Thank you for participating in our interview process. After careful consideration, we regret to inform you that we will not be proceeding with your application at this time. Reason: ${rejectionReason}`
                        }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - FAILED'
                    });
            } catch (chatError) {
                console.error('Error sending chat notification:', chatError);
                // Continue processing even if notification fails
            }
        }
        
        return res.status(200).json({ 
            success: true, 
            message: 'Applicant has been marked as REJECTED and notified.',
            newStatus: 'P3 - FAILED'
        });
        
    } catch (error) {
        console.error('Error in handleRejectApplicant:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while updating the applicant status'
        });
    }
},

getApplicantDetails: async function(req, res) {
    try {
        const { applicantId } = req.params;
        
        if (!applicantId) {
            return res.status(400).json({ success: false, message: 'Applicant ID is required' });
        }
        
        // Fetch applicant basic information
        const { data: applicant, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                userId,
                firstName,
                lastName,
                phoneNo,
                birthDate,
                applicantStatus,
                departmentId,
                jobId,
                hrInterviewFormScore,
                initialScreeningScore,
                created_at
            `)
            .eq('applicantId', applicantId)
            .single();
            
        if (applicantError) {
            console.error('Error fetching applicant:', applicantError);
            return res.status(500).json({ success: false, message: 'Error fetching applicant details' });
        }
        
        if (!applicant) {
            return res.status(404).json({ success: false, message: 'Applicant not found' });
        }
        
        // Fetch user email (if available)
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', applicant.userId)
            .single();
            
        // Get department name
        const { data: department, error: departmentError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', applicant.departmentId)
            .single();
            
        // Get job title
        const { data: job, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', applicant.jobId)
            .single();
            
        // Fetch screening assessment if available
        const { data: screening, error: screeningError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select(`
                initialScreeningId,
                degreeScore,
                experienceScore, 
                certificationScore,
                hardSkillsScore,
                softSkillsScore,
                workSetupScore,
                availabilityScore,
                totalScore,
                resume_url,
                degree_url,
                cert_url
            `)
            .eq('userId', applicant.userId)
            .single();
        
        // Combine all data
        const applicantDetails = {
            ...applicant,
            email: userData?.userEmail || 'N/A',
            department: department?.deptName || 'N/A',
            jobTitle: job?.jobTitle || 'N/A',
            screening: screening || null,
            documents: {
                resume: screening?.resume_url || null,
                degree: screening?.degree_url || null,
                certifications: screening?.cert_url || null
            }
        };
        
        // Return the applicant details
        return res.status(200).json({ 
            success: true, 
            applicant: applicantDetails 
        });
        
    } catch (error) {
        console.error('Error in getApplicantDetails:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while fetching applicant details',
            error: error.message
        });
    }
},



    getInterviewFormLinemanager: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/interview-form-linemanager');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getFirstDayObjectiveSetting: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/linemanagerfirstdayobjectivesetting');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    // Updated getApplicantDetails function for lineManagerController.js

getApplicantDetails: async function(req, res) {
    try {
        const { applicantId } = req.params;
        console.log('Fetching details for applicantId:', applicantId);

        if (!applicantId) {
            req.flash('errors', { message: 'Applicant ID is required' });
            return res.redirect('/linemanager/dashboard');
        }

        // Fetch basic applicant information
        const { data: applicant, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                userId,
                firstName,
                lastName,
                phoneNo,
                birthDate,
                applicantStatus,
                departmentId,
                jobId,
                hrInterviewFormScore,
                initialScreeningScore,
                p2_Approved,
                p2_hrevalscheduled,
                created_at
            `)
            .eq('applicantId', applicantId)
            .single();
            
        if (applicantError) {
            console.error('Error fetching applicant:', applicantError);
            req.flash('errors', { message: 'Error fetching applicant details' });
            return res.redirect('/linemanager/dashboard');
        }
        
        if (!applicant) {
            req.flash('errors', { message: 'Applicant not found' });
            return res.redirect('/linemanager/dashboard');
        }
        
        // Fetch user email (if available)
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', applicant.userId)
            .single();
            
        // Get department name
        const { data: department, error: departmentError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', applicant.departmentId)
            .single();
            
        // Get job title
        const { data: job, error: jobError } = await supabase
            .from('jobpositions')
            .select('jobTitle')
            .eq('jobId', applicant.jobId)
            .single();
            
        // Fetch screening assessment if available
        const { data: screening, error: screeningError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select(`
                initialScreeningId,
                degreeScore,
                experienceScore, 
                certificationScore,
                hardSkillsScore,
                softSkillsScore,
                workSetupScore,
                availabilityScore,
                totalScore,
                resume_url,
                degree_url,
                cert_url
            `)
            .eq('userId', applicant.userId)
            .single();
        
        // Fetch interview schedules if available
        const { data: interviews, error: interviewError } = await supabase
            .from('interviews')
            .select('interviewDate, interviewTime, interviewType, interviewStatus')
            .eq('applicantId', applicantId)
            .order('interviewDate', { ascending: false });

        if (interviewError) {
            console.error('Error fetching interview schedules:', interviewError);
            // Continue processing - interviews are optional
        }

        // Fetch Line Manager interview form results if available
        const { data: lineManagerForms, error: lineManagerFormError } = await supabase
            .from('linemanager_interview_forms')
            .select('totalRating, remarksByInterviewer, interviewDate')
            .eq('applicantId', applicantId)
            .order('interviewDate', { ascending: false });

        if (lineManagerFormError) {
            console.error('Error fetching line manager interview form:', lineManagerFormError);
            // Continue processing - line manager assessment is optional
        }

        // Combine all data into a comprehensive applicant profile
        const applicantProfile = {
            ...applicant,
            email: userData?.userEmail || 'N/A',
            department: department?.deptName || 'N/A',
            jobTitle: job?.jobTitle || 'N/A',
            screening: screening || null,
            interviews: interviews || [],
            lineManagerAssessment: lineManagerForms?.length > 0 ? lineManagerForms[0] : null,
            documents: {
                resume: screening?.resume_url || null,
                degree: screening?.degree_url || null,
                certifications: screening?.cert_url || null
            }
        };

        // Render the view with applicant data
        return res.render('staffpages/linemanager_pages/applicant-profile', {
            applicant: applicantProfile
        });
        
    } catch (error) {
        console.error('Error in getApplicantDetails:', error);
        req.flash('errors', { message: 'An error occurred while fetching applicant details' });
        return res.redirect('/linemanager/dashboard');
    }
},

// Add these functions to your lineManagerController.js to handle applicant approval and rejection

// Handle applicant approval
approveApplicant: async function(req, res) {
    try {
        const { applicantId } = req.body;
        
        if (!applicantId) {
            return res.status(400).json({ success: false, message: 'Applicant ID is required' });
        }
        
        // Get the current status
        const { data: applicant, error: fetchError } = await supabase
            .from('applicantaccounts')
            .select('applicantStatus, userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (fetchError) {
            console.error('Error fetching applicant:', fetchError);
            return res.status(500).json({ success: false, message: 'Error fetching applicant details' });
        }
        
        // Determine new status based on current status
        let newStatus;
        if (applicant.applicantStatus.includes('P1')) {
            newStatus = 'P1 - PASSED';
        } else if (applicant.applicantStatus.includes('P3')) {
            newStatus = 'P3 - PASSED';
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid applicant status for approval action' 
            });
        }
        
        // Update the applicant status
        const { error: updateError } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: newStatus,
                lineManagerApproved: true 
            })
            .eq('applicantId', applicantId);
            
        if (updateError) {
            console.error('Error updating applicant status:', updateError);
            return res.status(500).json({ success: false, message: 'Error updating applicant status' });
        }
        
        // Send notification to applicant via chatbot if available
        try {
            await supabase
                .from('chatbot_history')
                .insert({
                    userId: applicant.userId,
                    message: JSON.stringify({ 
                        text: "Congratulations! Your application has been approved by the Line Manager." 
                    }),
                    sender: 'bot',
                    timestamp: new Date().toISOString(),
                    applicantStage: newStatus
                });
        } catch (chatError) {
            console.error('Error sending chat notification:', chatError);
            // Continue processing even if notification fails
        }
        
        return res.json({ 
            success: true, 
            message: 'Applicant approved successfully',
            newStatus
        });
        
    } catch (error) {
        console.error('Error in approveApplicant:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while processing approval',
            error: error.message
        });
    }
},

// Handle applicant rejection
rejectApplicant: async function(req, res) {
    try {
        const { applicantId, reason } = req.body;
        
        if (!applicantId) {
            return res.status(400).json({ success: false, message: 'Applicant ID is required' });
        }
        
        // Get the current status
        const { data: applicant, error: fetchError } = await supabase
            .from('applicantaccounts')
            .select('applicantStatus, userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (fetchError) {
            console.error('Error fetching applicant:', fetchError);
            return res.status(500).json({ success: false, message: 'Error fetching applicant details' });
        }
        
        // Determine new status based on current status
        let newStatus;
        if (applicant.applicantStatus.includes('P1')) {
            newStatus = 'P1 - FAILED';
        } else if (applicant.applicantStatus.includes('P3')) {
            newStatus = 'P3 - FAILED';
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid applicant status for rejection action' 
            });
        }
        
        // Update the applicant status
        const { error: updateError } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: newStatus,
                lineManagerRejectionReason: reason || 'No reason provided'
            })
            .eq('applicantId', applicantId);
            
        if (updateError) {
            console.error('Error updating applicant status:', updateError);
            return res.status(500).json({ success: false, message: 'Error updating applicant status' });
        }
        
        // Send notification to applicant via chatbot if available
        try {
            const rejectionMessage = reason 
                ? `We regret to inform you that your application has not been successful. Reason: ${reason}`
                : "We regret to inform you that your application has not been successful at this time.";
                
            await supabase
                .from('chatbot_history')
                .insert({
                    userId: applicant.userId,
                    message: JSON.stringify({ text: rejectionMessage }),
                    sender: 'bot',
                    timestamp: new Date().toISOString(),
                    applicantStage: newStatus
                });
        } catch (chatError) {
            console.error('Error sending chat notification:', chatError);
            // Continue processing even if notification fails
        }
        
        return res.json({ 
            success: true, 
            message: 'Applicant rejected successfully',
            newStatus
        });
        
    } catch (error) {
        console.error('Error in rejectApplicant:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while processing rejection',
            error: error.message
        });
    }
},
    
    // This is the problematic function that needs to be fixed
getApplicantTracker: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        try {
            // First, get the line manager's department ID
            const userId = req.session.user.userId;
            const { data: lineManagerData, error: lineManagerError } = await supabase
                .from('staffaccounts')
                .select('departmentId')
                .eq('userId', userId)
                .single();

            if (lineManagerError) {
                console.error('Error fetching line manager department:', lineManagerError);
                throw lineManagerError;
            }

            const lineManagerDepartmentId = lineManagerData?.departmentId;

            if (!lineManagerDepartmentId) {
                console.error('Line manager has no department assigned');
                req.flash('errors', { authError: 'Department not assigned to your account. Please contact HR.' });
                return res.redirect('/staff/login');
            }

            // Fetch job positions filtered by the line manager's department
            const { data: jobpositions, error: jobpositionsError } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle, hiringStartDate, hiringEndDate, departmentId')
                .eq('departmentId', lineManagerDepartmentId) // Filter by the line manager's department
                .order('hiringStartDate', { ascending: true });

            if (jobpositionsError) throw jobpositionsError;

            // Fetch all departments for dropdown
            const { data: departments, error: departmentsError } = await supabase
                .from('departments')
                .select('deptName, departmentId');

            if (departmentsError) throw departmentsError;

            // Fetch all applicant accounts with created_at date
            const { data: applicantaccounts, error: applicantaccountsError } = await supabase
                .from('applicantaccounts')
                .select('jobId, applicantStatus, created_at');

            if (applicantaccountsError) throw applicantaccountsError;

            console.log('Applicant Accounts:', applicantaccounts);

            // Group and count statuses by jobId
            const statusCountsMap = {};
            const applicantDatesMap = {}; // To track application dates for each job

            // Add null check for applicantaccounts before iterating
            if (applicantaccounts && Array.isArray(applicantaccounts)) {
                applicantaccounts.forEach(({ jobId, applicantStatus, created_at }) => {
                    // Skip records with null or undefined values
                    if (!jobId || !applicantStatus) return;
                    
                    // Initialize if first time seeing this jobId
                    if (!statusCountsMap[jobId]) {
                        statusCountsMap[jobId] = { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 };
                        applicantDatesMap[jobId] = []; // Initialize array to store application dates
                    }
                    
                    // Add application date to the array for this job
                    if (created_at) {
                        applicantDatesMap[jobId].push(new Date(created_at));
                    }
                    
                    // Count applicants by status - Add null check on applicantStatus
                    if (applicantStatus && typeof applicantStatus === 'string') {
                        if (applicantStatus.includes('P1')) {
                            statusCountsMap[jobId].P1++;
                        } else if (applicantStatus.includes('P2')) {
                            statusCountsMap[jobId].P2++;
                        } else if (applicantStatus.includes('P3')) {
                            statusCountsMap[jobId].P3++;
                        } else if (applicantStatus.includes('Offered')) {
                            statusCountsMap[jobId].Offered++;
                        } else if (applicantStatus.includes('Onboarding')) {
                            statusCountsMap[jobId].Onboarding++;
                        }
                    }
                });
            }

            console.log('Status Counts Map:', statusCountsMap);
            console.log('Applicant Dates Map:', applicantDatesMap);

            // Function to check if any application date falls within hiring date range
            const hasApplicantsInDateRange = (jobId, hiringStart, hiringEnd) => {
                const applicantDates = applicantDatesMap[jobId] || [];
                // Handle case where dates might be missing
                if (!hiringStart || !hiringEnd) return false;
                
                const start = new Date(hiringStart);
                const end = new Date(hiringEnd);
                
                // Check if any application date falls within the hiring range
                return applicantDates.some(date => date >= start && date <= end);
            };

            // Merge counts into job positions with date check
            const jobPositionsWithCounts = jobpositions.map((job) => {
                const withinHiringRange = hasApplicantsInDateRange(
                    job.jobId, 
                    job.hiringStartDate, 
                    job.hiringEndDate
                );
                
                return {
                    ...job,
                    departmentName: departments.find(dept => dept.departmentId === job.departmentId)?.deptName || 'Unknown',
                    counts: statusCountsMap[job.jobId] || { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 },
                    hasApplicantsInDateRange: withinHiringRange // Add flag for highlighting in frontend
                };
            });

            // Render the page
            res.render('staffpages/linemanager_pages/linemanagerapplicanttracking', {
                jobPositions: jobPositionsWithCounts,
                departments,
            });
        } catch (err) {
            console.error('Error:', err);
            req.flash('errors', { databaseError: 'Error fetching job data.' });
            res.redirect('/staff/login');
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
        res.redirect('/staff/login');
    }
},

    getApplicantTrackerByJobPositions: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const { jobId, applicantId, userId } = req.query;
                console.log('Received request with jobId:', jobId, 'and applicantId:', applicantId);
                console.log('Received request with userId:', userId);

                const { data: applicants, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select(`
                    lastName, 
                    firstName, 
                    phoneNo,
                    userId,
                    jobId,
                    departmentId,
                    birthDate,
                    applicantStatus,
                    applicantId,
                    hrInterviewFormScore,
                    initialScreeningScore,
                    p2_Approved,
                    p2_hrevalscheduled
                `)
                .eq('jobId', jobId);
            
                if (applicantError) {
                    console.error('Error fetching applicants:', applicantError);
                    throw applicantError;
                }
                console.log('Fetched applicants:', applicants);
            
            // Fetch initial screening assessments separately
            const { data: screeningAssessments, error: screeningError } = await supabase
                .from('applicant_initialscreening_assessment')
                .select(`
                    userId,
                    initialScreeningId,
                    degreeScore,
                    experienceScore,
                    certificationScore,
                    hardSkillsScore,
                    softSkillsScore,
                    workSetupScore,
                    availabilityScore,
                    totalScore,
                    totalScoreCalculatedAt,
                    degree_url,
                    cert_url,
                    resume_url,
                    isHRChosen,
                    isLineManagerChosen
                `);
            
                if (screeningError) {
                    console.error('Error fetching screening assessments:', screeningError);
                    throw screeningError;
                }
                console.log('Fetched screening assessments:', screeningAssessments);
            
    
                // Fetch user emails using userId
                const { data: userAccounts, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail');
    
                if (userError) throw userError;
    
                // Fetch job titles and department names
                const { data: jobTitles, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle');
    
                if (jobError) throw jobError;
    
                const { data: departments, error: departmentError } = await supabase
                .from('departments')
                .select('departmentId, deptName');

                if (departmentError) {
                    console.error('Error fetching departments:', departmentError);
                    throw departmentError;
                }
                console.log('Fetched departments:', departments);

            for (const applicant of applicants) {
                console.log(`Processing applicant: ${applicant.firstName} ${applicant.lastName}`);


                applicant.jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'N/A';
    applicant.deptName = departments.find(dept => dept.departmentId === applicant.departmentId)?.deptName || 'N/A';
    applicant.userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
    applicant.birthDate = userAccounts.find(user => user.userId === applicant.userId)?.birthDate || 'N/A';


    // Match `userId` to fetch the corresponding initial screening assessment
    const screeningData = screeningAssessments.find(assessment => assessment.userId === applicant.userId) || {};

    // Merge the screening assessment data into the applicant object
    applicant.initialScreeningAssessment = {
        degreeScore: screeningData.degreeScore || 'N/A',
        experienceScore: screeningData.experienceScore || 'N/A',
        certificationScore: screeningData.certificationScore || 'N/A',
        hardSkillsScore: screeningData.hardSkillsScore || 'N/A',
        softSkillsScore: screeningData.softSkillsScore || 'N/A',
        workSetupScore: screeningData.workSetupScore || 'N/A',
        availabilityScore: screeningData.availabilityScore || 'N/A',
        totalScore: screeningData.totalScore || 'N/A',
        degree_url: screeningData.degree_url || '#',
        cert_url: screeningData.cert_url || '#',
        resume_url: screeningData.resume_url || '#',
    };

    console.log('Updated applicant details:', applicant);
}

console.log('Final applicants list:', applicants);
    
//                 // Merge jobTitle, deptName, userEmail, and scores with applicants data
//                 const applicantsWithDetails = applicants.map(applicant => {
//                     const jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'N/A';
//                     const deptName = departments.find(dept => dept.departmentId === applicant.departmentId)?.deptName || 'N/A';
//                     const userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
                
//                     let formattedStatus = applicant.applicantStatus;

// // If Line Manager has approved, set status to "P1: PASSED"
// if (applicant.lineManagerApproved) {
//     formattedStatus = 'P1 - PASSED';
// } else {
//     // Check Initial Screening Score
//     if (applicant.initialScreeningScore === null || applicant.initialScreeningScore === undefined) {
//         formattedStatus = 'P1 - Initial Screening';
//     } else if (applicant.initialScreeningScore < 50) {
//         formattedStatus = 'P1 - FAILED';
//     } else {
//         formattedStatus = `P1 - Awaiting for HR Action; Initial Screening Score: ${applicant.initialScreeningScore}`;
//     }

//     // Check HR Interview Score
//     if (applicant.hrInterviewFormScore !== null && applicant.hrInterviewFormScore !== undefined) {
//         if (applicant.hrInterviewFormScore < 50) {
//             formattedStatus = 'P1 - FAILED';
//         } else if (applicant.hrInterviewFormScore > 45 && applicant.isChosen1) {
//             formattedStatus = 'P1 - Awaiting for Line Manager Action; HR PASSED';
//         } else if (formattedStatus.startsWith('P1 - Awaiting for HR Action')) {
//             formattedStatus += `; HR Interview Score: ${applicant.hrInterviewFormScore}`;
//         }
//     }
// }
                
// // Log for debugging
// console.log("Applicant:", applicant.firstName, applicant.lastName, 
//     "Initial Screening Score:", applicant.initialScreeningScore, 
//     "HR Interview Score:", applicant.hrInterviewFormScore, 
//     "isChosen1:", applicant.isChosen1, 
//     "lineManagerApproved:", applicant.lineManagerApproved,
//     "LM_notified:", applicant.LM_notified,
//     "=> Status:", formattedStatus);
                
//                     // Return the updated applicant object with the formatted status
//                     return {
//                         ...applicant,
//                         jobTitle,
//                         deptName,
//                         userEmail,
//                         applicantStatus: formattedStatus, // Return the updated status
//                     };
//                 });
                
                // // Render the EJS template with applicants data
                // res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', {
                //     applicants: applicantsWithDetails,
                // });

                // Render the page with updated applicants
                res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', { 
                    applicants,
                    applicantsJSON: JSON.stringify(applicants) // Make data accessible in script
                });           } catch (error) {
                console.error('Error fetching applicants:', error);
                res.status(500).json({ error: 'Error fetching applicants' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. Line Manager role required.' });
            res.redirect('/staff/login');
        }
    },


        finalizeP1Review: async function(req, res) {
        try {
            console.log('✅ [LineManager] Preparing P1 review finalization with Gmail compose integration');
            
            const { passedUserIds, failedUserIds } = req.body;
            
            if (!passedUserIds || !failedUserIds) {
                return res.status(400).json({ success: false, message: "Missing user IDs" });
            }
            
            console.log(`✅ [LineManager] P1 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
            
            // Fetch email addresses and applicant details for passed users
            let passedApplicants = [];
            if (passedUserIds.length > 0) {
                const { data: passedData, error: passedError } = await supabase
                    .from('applicantaccounts')
                    .select(`
                        userId,
                        firstName,
                        lastName,
                        jobId,
                        useraccounts!inner(userEmail)
                    `)
                    .in('userId', passedUserIds);
                    
                if (passedError) {
                    console.error('❌ [LineManager] Error fetching passed applicants:', passedError);
                    return res.status(500).json({ success: false, message: "Error fetching passed applicants data" });
                }
                
                passedApplicants = passedData.map(applicant => ({
                    userId: applicant.userId,
                    name: `${applicant.firstName} ${applicant.lastName}`,
                    email: applicant.useraccounts.userEmail,
                    jobId: applicant.jobId
                }));
            }
            
            // Fetch email addresses and applicant details for failed users
            let failedApplicants = [];
            if (failedUserIds.length > 0) {
                const { data: failedData, error: failedError } = await supabase
                    .from('applicantaccounts')
                    .select(`
                        userId,
                        firstName,
                        lastName,
                        jobId,
                        useraccounts!inner(userEmail)
                    `)
                    .in('userId', failedUserIds);
                    
                if (failedError) {
                    console.error('❌ [LineManager] Error fetching failed applicants:', failedError);
                    return res.status(500).json({ success: false, message: "Error fetching failed applicants data" });
                }
                
                failedApplicants = failedData.map(applicant => ({
                    userId: applicant.userId,
                    name: `${applicant.firstName} ${applicant.lastName}`,
                    email: applicant.useraccounts.userEmail,
                    jobId: applicant.jobId
                }));
            }
            
            // Fetch job titles for email templates
            const allJobIds = [...new Set([...passedApplicants.map(a => a.jobId), ...failedApplicants.map(a => a.jobId)])];
            let jobTitles = {};
            
            if (allJobIds.length > 0) {
                const { data: jobData, error: jobError } = await supabase
                    .from('job_positions')
                    .select('jobId, jobTitle')
                    .in('jobId', allJobIds);
                    
                if (!jobError && jobData) {
                    jobTitles = jobData.reduce((acc, job) => {
                        acc[job.jobId] = job.jobTitle;
                        return acc;
                    }, {});
                }
            }
            
            // Add job titles to applicant data
            passedApplicants = passedApplicants.map(applicant => ({
                ...applicant,
                jobTitle: jobTitles[applicant.jobId] || 'Position'
            }));
            
            failedApplicants = failedApplicants.map(applicant => ({
                ...applicant,
                jobTitle: jobTitles[applicant.jobId] || 'Position'
            }));
            
            // Return applicant data for Gmail compose
            return res.status(200).json({ 
                success: true,
                requiresGmailCompose: true,
                passedApplicants: passedApplicants,
                failedApplicants: failedApplicants,
                message: "Ready for Gmail compose"
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error preparing P1 review finalization:', error);
            return res.status(500).json({ success: false, message: "Error preparing P1 review finalization: " + error.message });
        }
    },

    getEmailTemplates: async function(req, res) {
        try {
            const templates = getEmailTemplateData();
            return res.status(200).json({ success: true, templates });
            
        } catch (error) {
            console.error('❌ [LineManager] Error getting email templates:', error);
            return res.status(500).json({ success: false, message: "Error getting email templates: " + error.message });
        }
    },

    updateP1Statuses: async function(req, res) {
        try {
            console.log('✅ [LineManager] Updating P1 statuses after Gmail emails sent');
            
            const { passedUserIds, failedUserIds } = req.body;
            
            if (!passedUserIds || !failedUserIds) {
                return res.status(400).json({ success: false, message: "Missing user IDs" });
            }
            
            console.log(`✅ [LineManager] P1 Status Update: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
            
            let updateResults = {
                passed: { updated: 0, errors: [] },
                failed: { updated: 0, errors: [] }
            };
            
            // Update passed applicants
            for (const userId of passedUserIds) {
                try {
                    console.log(`✅ [LineManager] Updating P1 PASSED status for userId: ${userId}`);
                    
                    // Update applicant status in the database
                    const { data: updateData, error: updateError } = await supabase
                        .from('applicantaccounts')
                        .update({ applicantStatus: 'P1 - PASSED' })
                        .eq('userId', userId);
                        
                    if (updateError) {
                        console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                        updateResults.passed.errors.push(`${userId}: ${updateError.message}`);
                        continue;
                    }
                    
                    updateResults.passed.updated++;
                    
                    // Add chatbot message
                    const { data: chatData, error: chatError } = await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({ text: "Congratulations! You have successfully passed the initial screening process. We look forward to proceeding with the next interview stage." }),
                            sender: 'bot',
                            timestamp: new Date().toISOString(),
                            applicantStage: 'P1 - PASSED'
                        }]);
                        
                    if (chatError) {
                        console.error(`❌ [LineManager] Error adding chat message for ${userId}:`, chatError);
                    }
                    
                } catch (error) {
                    console.error(`❌ [LineManager] Error processing passed applicant ${userId}:`, error);
                    updateResults.passed.errors.push(`${userId}: ${error.message}`);
                }
            }
            
            // Update failed applicants
            for (const userId of failedUserIds) {
                try {
                    console.log(`✅ [LineManager] Updating P1 FAILED status for userId: ${userId}`);
                    
                    // Update applicant status in the database
                    const { data: updateData, error: updateError } = await supabase
                        .from('applicantaccounts')
                        .update({ applicantStatus: 'P1 - FAILED' })
                        .eq('userId', userId);
                        
                    if (updateError) {
                        console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                        updateResults.failed.errors.push(`${userId}: ${updateError.message}`);
                        continue;
                    }
                    
                    updateResults.failed.updated++;
                    
                    // Add chatbot message
                    const { data: chatData, error: chatError } = await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId,
                            message: JSON.stringify({ text: "We regret to inform you that you have not been chosen as a candidate for this position. Thank you for your interest in Prime Infrastructure, and we wish you the best in your future endeavors." }),
                            sender: 'bot',
                            timestamp: new Date().toISOString(),
                            applicantStage: 'P1 - FAILED'
                        }]);
                        
                    if (chatError) {
                        console.error(`❌ [LineManager] Error adding chat message for ${userId}:`, chatError);
                    }
                    
                } catch (error) {
                    console.error(`❌ [LineManager] Error processing failed applicant ${userId}:`, error);
                    updateResults.failed.errors.push(`${userId}: ${error.message}`);
                }
            }
            
            // Prepare response
            const totalUpdated = updateResults.passed.updated + updateResults.failed.updated;
            const totalErrors = updateResults.passed.errors.length + updateResults.failed.errors.length;
            
            if (totalErrors > 0) {
                console.warn(`⚠️ [LineManager] P1 status update completed with ${totalErrors} errors`);
                return res.status(207).json({ // 207 Multi-Status for partial success
                    success: true,
                    message: `P1 statuses updated with some errors. ${totalUpdated} successful, ${totalErrors} failed.`,
                    updateResults: updateResults,
                    passedUpdated: updateResults.passed.updated,
                    failedUpdated: updateResults.failed.updated,
                    totalErrors: totalErrors
                });
            } else {
                console.log(`✅ [LineManager] P1 status update completed successfully`);
                return res.status(200).json({ 
                    success: true, 
                    message: "P1 statuses updated successfully. All applicants have been processed.",
                    updateResults: updateResults,
                    passedUpdated: updateResults.passed.updated,
                    failedUpdated: updateResults.failed.updated,
                    totalUpdated: totalUpdated
                });
            }
            
        } catch (error) {
            console.error('❌ [LineManager] Error updating P1 statuses:', error);
            return res.status(500).json({ 
                success: false, 
                message: "Error updating P1 statuses: " + error.message 
            });
        }
    },

    markAsP1Passed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - PASSED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as PASSED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as PASSED. Status will be finalized after Gmail email is sent."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as PASSED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as PASSED: " + error.message });
        }
    },
    
    markAsP1Failed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - FAILED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as FAILED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as FAILED. Status will be finalized after Gmail email is sent."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as FAILED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as FAILED: " + error.message });
        }
    },
    
    /**
     * Temporary marks an applicant as PASSED for P3 in the Line Manager's view
     * This doesn't notify the applicant yet
     */
    markAsP3Passed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - PASSED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as P3 PASSED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as P3 PASSED. Status will be finalized and applicant will be notified upon review finalization."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as P3 PASSED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as P3 PASSED: " + error.message });
        }
    },
    
    /**
     * Temporary marks an applicant as FAILED for P3 in the Line Manager's view
     * This doesn't notify the applicant yet
     */
    markAsP3Failed: async function(req, res) {
        try {
            const { userId } = req.body;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: "Missing user ID" });
            }
            
            // Update the status for display purposes only
            const { data, error } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - FAILED (Pending Finalization)' })
                .eq('userId', userId);
                
            if (error) {
                console.error('❌ [LineManager] Error marking applicant as P3 FAILED:', error);
                return res.status(500).json({ success: false, message: "Error updating applicant status" });
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "Applicant marked as P3 FAILED. Status will be finalized and applicant will be notified upon review finalization."
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error marking as P3 FAILED:', error);
            return res.status(500).json({ success: false, message: "Error marking applicant as P3 FAILED: " + error.message });
        }
    },

// Modified finalizeP1Review function with email notifications
// finalizeP1Review: async function(req, res) {
//     try {
//       console.log('✅ [LineManager] Finalizing P1 review process');
      
//       const { passedUserIds, failedUserIds } = req.body;
      
//       if (!passedUserIds || !failedUserIds) {
//         return res.status(400).json({ success: false, message: "Missing user IDs" });
//       }
      
//       console.log(`✅ [LineManager] P1 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
      
//       // Process passed applicants
//       for (const userId of passedUserIds) {
//         console.log(`✅ [LineManager] Finalizing P1 PASSED for userId: ${userId}`);
        
//         // 1. Get user's email from the database
//         const { data: userData, error: userError } = await supabase
//           .from('useraccounts')
//           .select('userEmail, firstName, lastName')
//           .eq('userId', userId)
//           .single();
          
//         if (userError || !userData) {
//           console.error(`❌ [LineManager] Error fetching user email for ${userId}:`, userError);
//           continue;
//         }
        
//         const userEmail = userData.userEmail;
//         const userName = `${userData.firstName} ${userData.lastName}`;
        
//         if (!userEmail) {
//           console.error(`❌ [LineManager] No email found for user ${userId}`);
//           continue;
//         }
        
//         // 2. Update applicant status in the database
//         const { data: updateData, error: updateError } = await supabase
//           .from('applicantaccounts')
//           .update({ applicantStatus: 'P1 - PASSED' })
//           .eq('userId', userId);
          
//         if (updateError) {
//           console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
//           continue;
//         }
        
//         // 3. Send congratulations message through the chatbot history
//         const congratsMessage = "Congratulations! We are delighted to inform you that you have successfully passed the initial screening process. We look forward to proceeding with the next interview stage once the HR team sets availability via Calendly.";
        
//         const { data: chatData, error: chatError } = await supabase
//           .from('chatbot_history')
//           .insert([{
//             userId,
//             message: JSON.stringify({ text: congratsMessage }),
//             sender: 'bot',
//             timestamp: new Date().toISOString(),
//             applicantStage: 'P1 - PASSED'
//           }]);
          
//         if (chatError) {
//           console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
//         }
        
//         // 4. Send congratulatory email to the applicant
//         const emailSubject = 'Congratulations! You Passed the Initial Screening';
//         const emailHtml = `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
//             <div style="text-align: center; margin-bottom: 30px;">
//               <img src="https://your-company-logo-url.com" alt="Prime Infrastructure Logo" style="max-width: 200px; height: auto;">
//             </div>
            
//             <h1 style="color: #124A5C; text-align: center; margin-bottom: 20px;">Congratulations, ${userName}!</h1>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">We are delighted to inform you that you have successfully passed the initial screening process for your application with Prime Infrastructure.</p>
            
//             <div style="background-color: #f8f8f8; padding: 15px; border-radius: 6px; margin: 25px 0;">
//               <h2 style="color: #28a745; margin-top: 0;">What's Next?</h2>
//               <p style="font-size: 16px; line-height: 1.6; color: #333;">Our HR team will be reaching out soon with information regarding the next interview stage. You'll receive a Calendly invitation to schedule your interview at a time that works best for you.</p>
//             </div>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Please continue to monitor both your email inbox and the applicant portal for updates on your application status.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">If you have any questions in the meantime, feel free to respond to this email or contact our recruitment team at <a href="mailto:careers@primeinfra.com" style="color: #07ACB9;">careers@primeinfra.com</a>.</p>
            
//             <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
//               <p style="font-size: 14px; color: #666; text-align: center;">Best regards,<br>The Prime Infrastructure Recruitment Team</p>
//             </div>
            
//             <div style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">
//               <p>This is an automated email. Please do not reply directly to this message.</p>
//             </div>
//           </div>
//         `;
        
//         try {
//           await transporter.sendMail({
//             from: `"Prime Infrastructure Careers" <${process.env.EMAIL_USER}>`,
//             to: userEmail,
//             subject: emailSubject,
//             html: emailHtml,
//           });
//           console.log(`✅ [LineManager] Successfully sent congratulatory email to ${userEmail}`);
//         } catch (emailError) {
//           console.error(`❌ [LineManager] Error sending email to ${userEmail}:`, emailError);
//         }
//       }
      
//       // Process failed applicants
//       for (const userId of failedUserIds) {
//         console.log(`✅ [LineManager] Finalizing P1 FAILED for userId: ${userId}`);
        
//         // 1. Get user's email from the database
//         const { data: userData, error: userError } = await supabase
//           .from('useraccounts')
//           .select('userEmail, firstName, lastName')
//           .eq('userId', userId)
//           .single();
          
//         if (userError || !userData) {
//           console.error(`❌ [LineManager] Error fetching user email for ${userId}:`, userError);
//           continue;
//         }
        
//         const userEmail = userData.userEmail;
//         const userName = `${userData.firstName} ${userData.lastName}`;
        
//         if (!userEmail) {
//           console.error(`❌ [LineManager] No email found for user ${userId}`);
//           continue;
//         }
        
//         // 2. Update applicant status in the database
//         const { data: updateData, error: updateError } = await supabase
//           .from('applicantaccounts')
//           .update({ applicantStatus: 'P1 - FAILED' })
//           .eq('userId', userId);
          
//         if (updateError) {
//           console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
//           continue;
//         }
        
//         // 3. Send rejection message through the chatbot history
//         const rejectionMessage = "We regret to inform you that you have not been chosen as a candidate for this position. Thank you for your interest in applying at Prime Infrastructure, and we wish you the best in your future endeavors.";
        
//         const { data: chatData, error: chatError } = await supabase
//           .from('chatbot_history')
//           .insert([{
//             userId,
//             message: JSON.stringify({ text: rejectionMessage }),
//             sender: 'bot',
//             timestamp: new Date().toISOString(),
//             applicantStage: 'P1 - FAILED'
//           }]);
          
//         if (chatError) {
//           console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
//         }
        
//         // 4. Send rejection email to the applicant
//         const emailSubject = 'Update on Your Application with Prime Infrastructure';
//         const emailHtml = `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
//             <div style="text-align: center; margin-bottom: 30px;">
//               <img src="https://your-company-logo-url.com" alt="Prime Infrastructure Logo" style="max-width: 200px; height: auto;">
//             </div>
            
//             <h1 style="color: #124A5C; text-align: center; margin-bottom: 20px;">Application Update</h1>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Dear ${userName},</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Thank you for your interest in joining Prime Infrastructure and for taking the time to apply for our position.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">After careful consideration of all applications, we regret to inform you that we have decided not to proceed with your application at this time.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Please note that this decision does not reflect on your qualifications or experience. We received many applications from qualified candidates, and the selection process was highly competitive.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">We encourage you to continue monitoring our careers page for future opportunities that match your skills and interests, as we would be happy to consider you for other positions in the future.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">We wish you the best in your job search and future career endeavors.</p>
            
//             <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
//               <p style="font-size: 14px; color: #666; text-align: center;">Best regards,<br>The Prime Infrastructure Recruitment Team</p>
//             </div>
            
//             <div style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">
//               <p>This is an automated email. Please do not reply directly to this message.</p>
//             </div>
//           </div>
//         `;
        
//         try {
//           await transporter.sendMail({
//             from: `"Prime Infrastructure Careers" <${process.env.EMAIL_USER}>`,
//             to: userEmail,
//             subject: emailSubject,
//             html: emailHtml,
//           });
//           console.log(`✅ [LineManager] Successfully sent rejection email to ${userEmail}`);
//         } catch (emailError) {
//           console.error(`❌ [LineManager] Error sending email to ${userEmail}:`, emailError);
//         }
//       }
      
//       return res.status(200).json({ 
//         success: true, 
//         message: "P1 review finalized successfully and applicants have been notified via both chatbot and email.",
//         passedCount: passedUserIds.length,
//         failedCount: failedUserIds.length
//       });
      
//     } catch (error) {
//       console.error('❌ [LineManager] Error finalizing P1 review:', error);
//       return res.status(500).json({ success: false, message: "Error finalizing P1 review: " + error.message });
//     }
//   },
    
    finalizeP3Review: async function(req, res) {
        try {
            console.log('✅ [LineManager] Finalizing P3 review process');
            
            const { passedUserIds, failedUserIds } = req.body;
            
            if (!passedUserIds || !failedUserIds) {
                return res.status(400).json({ success: false, message: "Missing user IDs" });
            }
            
            console.log(`✅ [LineManager] P3 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
            
            // Process passed applicants
            for (const userId of passedUserIds) {
                console.log(`✅ [LineManager] Finalizing P3 PASSED for userId: ${userId}`);
                
                // 1. Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - PASSED' })
                    .eq('userId', userId);
                    
                if (updateError) {
                    console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                    continue;
                }
                
                // 2. Send congratulations message through the chatbot history
                const congratsMessage = "Congratulations! We are delighted to inform you that you have successfully passed the final interview. You will be contacted soon with job offer details.";
                
                const { data: chatData, error: chatError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: congratsMessage }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - PASSED'
                    }]);
                    
                if (chatError) {
                    console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
                }
            }
            
            // Process failed applicants
            for (const userId of failedUserIds) {
                console.log(`✅ [LineManager] Finalizing P3 FAILED for userId: ${userId}`);
                
                // 1. Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - FAILED' })
                    .eq('userId', userId);
                    
                if (updateError) {
                    console.error(`❌ [LineManager] Error updating status for ${userId}:`, updateError);
                    continue;
                }
                
                // 2. Send rejection message through the chatbot history
                const rejectionMessage = "We appreciate your participation in our interview process. After careful consideration, we regret to inform you that we will not be proceeding with your application at this time. Thank you for your interest in Prime Infrastructure.";
                
                const { data: chatData, error: chatError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: rejectionMessage }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - FAILED'
                    }]);
                    
                if (chatError) {
                    console.error(`❌ [LineManager] Error sending chat message to ${userId}:`, chatError);
                }
            }
            
            return res.status(200).json({ 
                success: true, 
                message: "P3 review finalized successfully and applicants have been notified.",
                passedCount: passedUserIds.length,
                failedCount: failedUserIds.length
            });
            
        } catch (error) {
            console.error('❌ [LineManager] Error finalizing P3 review:', error);
            return res.status(500).json({ success: false, message: "Error finalizing P3 review: " + error.message });
        }
    },
    

    // updateP1LineManagerPassed: async function(req, res) {
    //     try {
    //         const { passedUserIds, failedUserIds } = req.body;
            
    //         if (!passedUserIds || !failedUserIds) {
    //             return res.status(400).json({ success: false, message: "Missing required data" });
    //         }
            
    //         console.log(`Finalizing P1 review for ${passedUserIds.length} passed and ${failedUserIds.length} failed applicants`);
            
    //         // Update passed applicants to P1 - PASSED
    //         if (passedUserIds.length > 0) {
    //             const { data: passedData, error: passedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P1 - PASSED' })
    //                 .in('userId', passedUserIds);
                    
    //             if (passedError) {
    //                 console.error(`Error updating P1 passed applicants:`, passedError);
    //                 return res.status(500).json({ success: false, message: "Error updating passed applicants" });
    //             }
    //         }
            
    //         // Update failed applicants to P1 - FAILED
    //         if (failedUserIds.length > 0) {
    //             const { data: failedData, error: failedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P1 - FAILED' })
    //                 .in('userId', failedUserIds);
                    
    //             if (failedError) {
    //                 console.error(`Error updating P1 failed applicants:`, failedError);
    //                 return res.status(500).json({ success: false, message: "Error updating failed applicants" });
    //             }
    //         }
            
    //         // Send success response
    //         return res.status(200).json({ 
    //             success: true, 
    //             message: `Successfully finalized P1 review for ${passedUserIds.length + failedUserIds.length} applicants` 
    //         });
            
    //     } catch (error) {
    //         console.error("Error finalizing P1 review:", error);
    //         return res.status(500).json({ success: false, message: "Server error" });
    //     }
    // },

    // updateP3LineManagerPassed: async function(req, res) {
    //     try {
    //         const { passedUserIds, failedUserIds } = req.body;
            
    //         if (!passedUserIds || !failedUserIds) {
    //             return res.status(400).json({ success: false, message: "Missing required data" });
    //         }
            
    //         console.log(`Finalizing P3 review for ${passedUserIds.length} passed and ${failedUserIds.length} failed applicants`);
            
    //         // Update passed applicants to P3 - PASSED
    //         if (passedUserIds.length > 0) {
    //             const { data: passedData, error: passedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P3 - PASSED' })
    //                 .in('userId', passedUserIds);
                    
    //             if (passedError) {
    //                 console.error(`Error updating P3 passed applicants:`, passedError);
    //                 return res.status(500).json({ success: false, message: "Error updating passed applicants" });
    //             }
    //         }
            
    //         // Update failed applicants to P3 - FAILED
    //         if (failedUserIds.length > 0) {
    //             const { data: failedData, error: failedError } = await supabase
    //                 .from('applicantaccounts')
    //                 .update({ applicantStatus: 'P3 - FAILED' })
    //                 .in('userId', failedUserIds);
                    
    //             if (failedError) {
    //                 console.error(`Error updating P3 failed applicants:`, failedError);
    //                 return res.status(500).json({ success: false, message: "Error updating failed applicants" });
    //             }
    //         }
            
    //         // Send success response
    //         return res.status(200).json({ 
    //             success: true, 
    //             message: `Successfully finalized P3 review for ${passedUserIds.length + failedUserIds.length} applicants` 
    //         });
            
    //     } catch (error) {
    //         console.error("Error finalizing P3 review:", error);
    //         return res.status(500).json({ success: false, message: "Server error" });
    //     }
    // },


    

    postApproveLineManager: async function (req, res) {
        console.log('Request Body:', req.body); // Log the entire request body
    
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            const { applicantId } = req.body; // Get applicantId from request body
    
            if (!applicantId) {
                return res.status(400).json({ success: false, error: 'Missing applicantId' });
            }
    
            try {
                const { error } = await supabase
                .from('applicantaccounts')
                .update({ 
                    applicantStatus: 'P1 - PASSED', // Ensure correct status
                    lineManagerApproved: true 
                })
                .eq('applicantId', applicantId);
    
                if (error) throw error;
    
                res.json({ success: true, message: 'Line Manager approved successfully' });
            } catch (error) {
                console.error('Error updating applicant status:', error);
                return res.status(500).json({ success: false, error: 'Failed to approve Line Manager' });
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized access. Line Manager role required.' });
            res.redirect('/staff/login');
        }
    },
    
    

    getFinalResult: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/linemanagerfinalresult');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getApprovedFinalResult: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/approvedfinalresults');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },

    getRejectedFinalResult: function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            res.render('staffpages/linemanager_pages/rejectedfinalresults');
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },
    
    
    getRequestMRF: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const { data: departments, error } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
    
                if (error) throw error;
    
                res.render('staffpages/linemanager_pages/request-mrf', { departments });
            } catch (err) {
                req.flash('errors', { fetchError: 'Error fetching departments.' });
                res.redirect('/linemanager/mrf'); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            res.redirect('/staff/login');
        }
    },
    

    submitMRF: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
            req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
            return res.redirect('/staff/login');
        }
    
        console.log("Request Body:", req.body); // Log the entire form data
    
        const mrfData = {
            jobGrade: req.body.jobGrade,
            positionTitle: req.body.positionTitle,
            departmentId: req.body.departmentId,
            location: req.body.location,
            requisitionDate: req.body.requisitionDate,
            requiredDate: req.body.requiredDate,
            numPersonsRequisitioned: req.body.numPersonsRequisitioned,
            requisitionType: req.body.requisitionType,
            employmentNature: req.body.employmentNature,
            employeeCategory: req.body.employeeCategory,
            justification: req.body.justification || '', // Default to an empty string if undefined
            requiredAttachments: req.body.requiredAttachments ? req.body.requiredAttachments.join(', ') : '',
            userId: req.session.user.userId,
            status: 'Pending'
        };
    
        console.log("MRF Data to be inserted:", mrfData);
    
        try {
            // Insert MRF
            const { data, error } = await supabase
                .from('mrf')
                .insert([mrfData])
                .select();
    
            if (error) {
                console.error("Supabase Error (MRF):", error.message, error.details);
                throw error;
            }
    
            if (!data || data.length === 0) {
                throw new Error("No MRF data returned after insertion.");
            }
    
            console.log("Inserted MRF data:", data);
    
            // Log the approval status from the form
            console.log("Approval Status:", req.body.approvalStatus);
    
            // Log the MRF ID
            console.log("Inserted MRF ID:", data[0].mrfId);
    
            // Approval logic
            if (req.body.approvalStatus === 'approved') {
                let reviewerName;
    
                // Fetch the reviewer's name if it's missing from the session
                if (!req.session.user.userName) {
                    const { data: staffData, error: staffError } = await supabase
                        .from('staffaccounts')
                        .select('firstName, lastName')
                        .eq('userId', req.session.user.userId)
                        .single();
    
                    if (staffError) {
                        console.error("Error fetching staff details:", staffError.message, staffError.details);
                        throw staffError;
                    }
    
                    reviewerName = `${staffData.firstName} ${staffData.lastName}`.trim();
                } else {
                    reviewerName = req.session.user.userName;
                }
    
                console.log("Reviewer Name:", reviewerName);
    
                const approvalData = {
                    mrfId: data[0].mrfId,
                    staffId: req.session.user.userId,
                    approval_stage: req.session.user.userRole,
                    reviewerName, 
                    reviewerDateSigned: new Date().toISOString()
                };
    
                console.log("Approval Data to be inserted:", approvalData);
    
                const { error: approvalError } = await supabase
                    .from('mrf_approvals')
                    .insert([approvalData]);
    
                if (approvalError) {
                    console.error("Supabase Error (MRF Approvals):", approvalError.message, approvalError.details);
                    throw approvalError;
                }
    
                console.log("Approval data inserted:", approvalData);
            } else {
                console.log("Approval checkbox was not checked.");
            }
    
            req.flash('success', { message: 'MRF Request submitted successfully!' });
            return res.redirect('/linemanager/mrf');
        } catch (error) {
            console.error("Error in MRF submission or approval insertion:", error);
            req.flash('errors', { submissionError: 'Failed to submit MRF. Please try again.' });
            return res.redirect('/linemanager/mrf'); // Redirecting to /linemanager/mrf on error as well
        }
    },      
    
    // almost the same logic as hr but only by the same department is fetched.
    getRecordsPerformanceTrackerByDepartmentId: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'Line Manager') {
            try {
                const userId = req.session.user.userId; // Get the logged-in user's userId
                console.log('User ID:', userId); // Log the userId for debugging
    
                if (!userId) {
                    req.flash('errors', { fetchError: 'User ID is not defined. Please log in again.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch data from useraccounts table
                const { data: userData, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail')
                    .eq('userId', userId)
                    .single(); // Get a single user account
    
                if (userError || !userData) {
                    throw userError || new Error('Failed to fetch user data.');
                }
    
                // Now fetch the associated staff account to get departmentId
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('departmentId')
                    .eq('userId', userId)
                    .single(); // Get a single staff record
    
                if (staffError || !staffData) {
                    throw staffError || new Error('Failed to fetch staff data.');
                }
    
                const deptId = staffData.departmentId; // Retrieve departmentId
                console.log('Department ID:', deptId); // Log the departmentId for debugging
    
                if (!deptId) {
                    req.flash('errors', { fetchError: 'Department ID is not defined. Please log in again.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch data from staffaccounts filtered by departmentId
                const { data: employeeData, error: fetchError } = await supabase
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
                    .eq('departmentId', deptId) // Filter by departmentId
                    .order('lastName', { ascending: true }); // Sort by lastName
    
                if (fetchError) {
                    throw fetchError;
                }
    
                // Map the fetched data to a structured employee list
                const employeeList = employeeData.map(staff => ({
                    userId: staff.userId || 'Unknown',  // Ensure userId exists
                    lastName: staff.lastName || 'Unknown',
                    firstName: staff.firstName || 'Unknown',
                    deptName: staff.departments?.deptName || 'Unknown',
                    jobTitle: staff.jobpositions?.jobTitle || 'No job title assigned',
                    email: staff.useraccounts?.userEmail || 'N/A'
                }));
    
                console.log("Employee data fetched successfully:", employeeList);
    
                const errors = req.flash('errors') || {};  
                res.render('staffpages/linemanager_pages/managerrecordsperftracker', { errors, employees: employeeList });
    
            } catch (error) {
                console.error('Error fetching Employee Records and Performance History data:', error);
                req.flash('errors', { fetchError: 'Failed to fetch employee records. Please try again.' });
                res.redirect('/linemanager/dashboard');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    getRecordsPerformanceTrackerByUserId: async function(req, res, next) {
        try {
            const userId = req.params.userId;
            console.log('Fetching records for userId:', userId);
        
            if (!userId) {
                req.flash('errors', { authError: 'User not logged in.' });
                return res.redirect('/staff/login');
            }
        
            // Fetch user-related data
            const { data: userData, error } = await supabase
                .from('useraccounts')
                .select(`
                    userId,
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
                        departments ( deptName ),
                        jobpositions ( jobTitle ),
                        staffdegrees ( degreeName, universityName, graduationYear ),
                        staffcareerprogression ( milestoneName, startDate, endDate ),
                        staffexperiences ( companyName, startDate ),
                        staffcertification!staffcertification_staffId_fkey ( certificateName, certDate )
                    )
                `)
                .eq('userId', userId)
                .single();
        
            if (error) throw error;
        
            console.log('Fetched user data:', userData);
        
            // Fetch attendance logs for the specific user
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
                .eq('userId', userId)
                .order('attendanceDate', { ascending: false });
        
            if (attendanceError) throw attendanceError;
        
            // Format attendance logs by week
            const formattedAttendanceLogs = attendanceLogs.reduce((acc, attendance) => {
                const attendanceDate = new Date(attendance.attendanceDate);
                // Get the week number for the given date (ISO week)
                const weekNumber = getISOWeek(attendanceDate);
                
                const weekEntry = acc.find(log => log.weekNumber === weekNumber);
        
                if (!weekEntry) {
                    acc.push({
                        weekNumber,
                        days: [{
                            date: attendanceDate,
                            attendanceAction: attendance.attendanceAction,
                            attendanceTime: attendance.attendanceTime
                        }]
                    });
                } else {
                    weekEntry.days.push({
                        date: attendanceDate,
                        attendanceAction: attendance.attendanceAction,
                        attendanceTime: attendance.attendanceTime
                    });
                }
        
                return acc;
            }, []);
        
            // Compile the userData into the format required for the template
            const formattedUserData = {
                userId: userData.userId,
                userEmail: userData.userEmail || '',
                userRole: userData.userRole || '',
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
                certifications: userData.staffaccounts[0]?.staffcertification || [],
                weeklyAttendanceLogs: formattedAttendanceLogs // Add weekly attendance logs
            };
        
            req.user = formattedUserData;
            next();
        } catch (err) {
            console.error('Error in getRecordsPerformanceTrackerByUserId controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('/staffpages/linemanager_pages/managerrecordsperftracker');
        }
    },

    // code with midyearidp logic
   // Fixed getUserProgressView function - specifically the stepper logic section
getUserProgressView: async function(req, res) {
    const user = req.user;
    console.log('Fetching records for userId:', user?.userId);

    if (!user) {
        req.flash('errors', { authError: 'Unauthorized. Please log in to access this view.' });
        return res.redirect('/staff/login');
    }

    try {
        const { data: jobData, error: jobError } = await supabase
            .from('staffaccounts')
            .select('jobId')
            .eq('userId', user.userId)
            .single();

        if (jobError || !jobData) {
            console.error('Error fetching jobId:', jobError);
            req.flash('errors', { fetchError: 'Error fetching job information. Please try again.' });
            return res.redirect('/linemanager/records-performance-tracker');
        }

        const jobId = jobData.jobId;
        console.log('Fetched jobId:', jobId);

        const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4'];
        const yearPromises = feedbackTables.map(table => 
            supabase.from(table).select('year')
        );

        const yearResults = await Promise.all(yearPromises);
        const allYears = yearResults.flatMap(result => result.data || []);
        const availableYears = [...new Set(allYears.map(year => year.year))].sort((a, b) => b - a);
        const selectedYear = req.query.year || new Date().getFullYear();

        const feedbackData = {};
        for (const table of feedbackTables) {
            const { data, error } = await supabase
                .from(table)
                .select('*')
                .eq('userId', user.userId)
                .eq('jobId', jobId)
                .eq('year', selectedYear);

            if (error) {
                console.error(`Error fetching feedback data from ${table}:`, error);
                req.flash('errors', { fetchError: `Error fetching data for ${table}. Please try again.` });
                return res.redirect('/linemanager/records-performance-tracker');
            }

            feedbackData[table] = data;
        }

        console.log("Feedback Data:", feedbackData);

        // Fetch objectives settings
        const { data: objectiveSettings, error: objectivesError } = await supabase
            .from('objectivesettings')
            .select('*')
            .eq('userId', user.userId);

        if (objectivesError) {
            console.error('Error fetching objectives settings:', objectivesError);
            req.flash('errors', { fetchError: 'Error fetching objectives settings. Please try again.' });
            return res.redirect('/linemanager/records-performance-tracker');
        }

        let submittedObjectives = [];
        let objectiveQuestions = [];

        if (objectiveSettings.length > 0) {
            const objectiveSettingsIds = objectiveSettings.map(setting => setting.objectiveSettingsId);

            // Fetch the actual objectives related to the settings
            const { data: objectivesData, error: objectivesFetchError } = await supabase
                .from('objectivesettings_objectives')
                .select('*')
                .in('objectiveSettingsId', objectiveSettingsIds);

            if (objectivesFetchError) {
                console.error('Error fetching objectives:', objectivesFetchError);
                req.flash('errors', { fetchError: 'Error fetching objectives. Please try again.' });
                return res.redirect('/linemanager/records-performance-tracker');
            }

            submittedObjectives = objectivesData;

            // Fetch questions related to the objectives
            const { data: objectiveQuestionData, error: questionError } = await supabase
                .from('feedbacks_questions-objectives')
                .select('objectiveId, objectiveQualiQuestion')
                .in('objectiveId', submittedObjectives.map(obj => obj.objectiveId));

            if (questionError) {
                console.error('Error fetching objective questions:', questionError);
                req.flash('errors', { fetchError: 'Error fetching objective questions. Please try again.' });
                return res.redirect('/linemanager/records-performance-tracker');
            }

            objectiveQuestions = objectiveQuestionData;
        }

        // Map the `objectiveQuestions` to `submittedObjectives`
        submittedObjectives = submittedObjectives.map(obj => {
            const questions = objectiveQuestions.filter(q => q.objectiveId === obj.objectiveId);
            return {
                ...obj,
                objectiveQualiQuestion: questions.length > 0 ? questions.map(q => q.objectiveQualiQuestion).join(', ') : 'No questions available'
            };
        });

        // Fetch job requirements skills based on jobId
        const { data: skillsData, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillType, jobReqSkillName')
            .eq('jobId', jobId);

        if (skillsError) {
            console.error('Error fetching job requirements skills:', skillsError);
            req.flash('errors', { fetchError: 'Error fetching skills data. Please try again.' });
            return res.redirect('/linemanager/records-performance-tracker');
        }

        // Classify skills into Hard and Soft
        const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
        const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];

        // Check if Mid-Year IDP data exists to control access to steps
        const { data: midYearData, error: midYearError } = await supabase
            .from('midyearidps')
            .select('*')
            .eq('userId', user.userId)
            .eq('jobId', jobId)
            .eq('year', selectedYear)
            .maybeSingle(); // FIXED: Use maybeSingle() instead of single()

        if (midYearError) {
            console.error('Error fetching mid-year IDP data:', midYearError);
        }

        // Check if Final-Year IDP data exists
        const { data: finalYearData, error: finalYearError } = await supabase
            .from('finalyearidps')
            .select('*')
            .eq('userId', user.userId)
            .eq('jobId', jobId)
            .eq('year', selectedYear)
            .maybeSingle(); // FIXED: Use maybeSingle() instead of single()

        if (finalYearError) {
            console.error('Error fetching final-year IDP data:', finalYearError);
        }

        // FIXED: Define viewState with proper stepper logic
        const viewState = {
            success: true,
            userId: user.userId,
            jobId,
            feedbacks: feedbackData,
            hardSkills,
            softSkills,
            objectiveQuestions,
            submittedObjectives,
            years: availableYears,
            selectedYear,
            performancePeriodYear: selectedYear,
            midYearData: midYearData,
            finalYearData: finalYearData,
            viewOnlyStatus: {
                // Objective setting is view-only if objectives exist
                objectivesettings: objectiveSettings.length > 0,
                
                // Feedback quarters are view-only if they have data
                feedbacks_Q1: feedbackData['feedbacks_Q1']?.length > 0,
                feedbacks_Q2: feedbackData['feedbacks_Q2']?.length > 0,
                feedbacks_Q3: feedbackData['feedbacks_Q3']?.length > 0,
                feedbacks_Q4: feedbackData['feedbacks_Q4']?.length > 0,
                
                // IDP sections are view-only if data exists
                midyearidp: midYearData ? true : false,
                finalyearidp: finalYearData ? true : false,
            },
        };

        // FIXED: Function to calculate nextStep based on proper stepper progression
        function calculateNextStep(viewState) {
            let nextStep = null;

            // Step 1: Objectives Setting (always accessible first)
            if (!viewState.viewOnlyStatus.objectivesettings) {
                nextStep = 1;  // Complete Objectives Setting
            }
            // Step 2: Q1 Feedback (accessible after objectives)
            else if (!viewState.viewOnlyStatus.feedbacks_Q1) {
                nextStep = 2;  // Complete Q1 Feedback
            }
            // Step 3: Q2 Feedback (accessible after Q1)
            else if (!viewState.viewOnlyStatus.feedbacks_Q2) {
                nextStep = 3;  // Complete Q2 Feedback
            }
            // Step 4: Mid-Year IDP (accessible after Q2)
            else if (!viewState.viewOnlyStatus.midyearidp) {
                nextStep = 4;  // Complete Mid-Year IDP
            }
            // Step 5: Q3 Feedback (accessible after Mid-Year IDP)
            else if (!viewState.viewOnlyStatus.feedbacks_Q3) {
                nextStep = 5;  // Complete Q3 Feedback
            }
            // Step 6: Q4 Feedback (accessible after Q3)
            else if (!viewState.viewOnlyStatus.feedbacks_Q4) {
                nextStep = 6;  // Complete Q4 Feedback
            }
            // Step 7: Final-Year IDP (accessible after Q4)
            else if (!viewState.viewOnlyStatus.finalyearidp) {
                nextStep = 7;  // Complete Final-Year IDP
            }
            // All steps completed
            else {
                nextStep = null;  // All steps completed
            }

            return nextStep;
        }

        // Add the nextStep to the viewState
        viewState.nextAccessibleStep = calculateNextStep(viewState);

        console.log("View State:", viewState);
        console.log("Next accessible step:", viewState.nextAccessibleStep);

        res.render('staffpages/linemanager_pages/managerrecordsperftracker-user', { 
            viewState: viewState, 
            user, 
            nextAccessibleStep: viewState.nextAccessibleStep
        });

    } catch (error) {
        console.error('Error fetching user progress:', error);
        req.flash('errors', { fetchError: 'Error fetching user progress. Please try again.' });
        res.redirect('/linemanager/records-performance-tracker');
    }
},

// Controller method to fetch feedback questionnaire data
getFeedbackQuestionnaire: async function(req, res) {
    try {
        const userId = req.params.userId;
        const quarter = req.query.quarter; // e.g., "Q1", "Q2", etc.
        
        console.log(`=== getFeedbackQuestionnaire START ===`);
        console.log(`Received request - userId: ${userId}, quarter: ${quarter}`);
        
        if (!userId || !quarter) {
            console.log('Missing required parameters');
            return res.status(400).json({
                success: false, 
                message: "User ID and quarter are required."
            });
        }
        
        // 1. Determine which feedback table to query
        let feedbackTable, feedbackIdField;
        
        switch (quarter) {
            case 'Q1':
                feedbackTable = 'feedbacks_Q1';
                feedbackIdField = 'feedbackq1_Id';
                break;
            case 'Q2':
                feedbackTable = 'feedbacks_Q2';
                feedbackIdField = 'feedbackq2_Id';
                break;
            case 'Q3':
                feedbackTable = 'feedbacks_Q3';
                feedbackIdField = 'feedbackq3_Id';
                break;
            case 'Q4':
                feedbackTable = 'feedbacks_Q4';
                feedbackIdField = 'feedbackq4_Id';
                break;
            default:
                console.log(`Invalid quarter: ${quarter}`);
                return res.status(400).json({
                    success: false,
                    message: "Invalid quarter specified."
                });
        }
        
        console.log(`Using table: ${feedbackTable}, field: ${feedbackIdField}`);
        
        // 2. Get the user's job information
        console.log('Fetching staff data...');
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('jobId')
            .eq('userId', userId)
            .single();
            
        if (staffError || !staffData) {
            console.error('Error fetching staff data:', staffError);
            return res.status(404).json({
                success: false,
                message: "User job information not found."
            });
        }
        
        const jobId = staffData.jobId;
        
        // FIXED: Use selectedYear from query parameter instead of hardcoded currentYear
        const selectedYear = req.query.year || new Date().getFullYear();
        console.log(`Found jobId: ${jobId}, selectedYear: ${selectedYear}`);
        
        // 3. Try to get existing feedback record - FIXED: Handle both null data and errors properly
        console.log(`Checking for existing ${quarter} feedback record...`);
        
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`
                ${feedbackIdField},
                userId,
                jobId,
                setStartDate,
                setEndDate,
                dateCreated,
                year,
                quarter
            `)
            .eq('userId', userId)
            .eq('jobId', jobId)
            .eq('quarter', quarter)
            .eq('year', selectedYear)
            .maybeSingle();
            
        // FIXED: Only return error if there's an actual database error, not if data is null
        if (feedbackError) {
            console.error(`Database error querying ${feedbackTable}:`, feedbackError);
            return res.status(500).json({
                success: false,
                message: `Database error checking existing feedback: ${feedbackError.message}`
            });
        }
        
        console.log(`Feedback query completed. Data found:`, !!feedbackData);
        
        // Initialize variables
        let feedbackId = null;
        let startDate = null;
        let endDate = null;
        let feedbackYear = selectedYear;
        let isViewOnly = false;
        
        if (feedbackData) {
            feedbackId = feedbackData[feedbackIdField];
            // FIXED: Format dates properly for HTML date inputs
            startDate = feedbackData.setStartDate ? new Date(feedbackData.setStartDate).toISOString().split('T')[0] : null;
            endDate = feedbackData.setEndDate ? new Date(feedbackData.setEndDate).toISOString().split('T')[0] : null;
            feedbackYear = feedbackData.year;
            isViewOnly = true;
            console.log(`✓ Found existing ${quarter} feedback:`);
            console.log(`  - FeedbackId: ${feedbackId}`);
            console.log(`  - StartDate: ${startDate}`);
            console.log(`  - EndDate: ${endDate}`);
            console.log(`  - Year: ${feedbackYear}`);
            console.log(`  - Mode: View-Only`);
        } else {
            console.log(`✓ No existing ${quarter} feedback found for user ${userId} in year ${selectedYear}`);
            console.log(`  - Mode: Edit (New questionnaire can be created)`);
        }
        
        // 4. FIXED: Get the objective settings for this user - simplified query to match getUserProgressView
        console.log('Fetching objective settings...');
        const { data: objectiveSettings, error: objectivesSettingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId, performancePeriodYear')
            .eq('userId', userId)
            .order('created_at', { ascending: false });
            
        if (objectivesSettingsError) {
            console.error('Error fetching objective settings:', objectivesSettingsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objective settings."
            });
        }
        
        console.log(`Found ${objectiveSettings?.length || 0} objective settings records`);
        
        // FIXED: Look for objective settings for the selected year, or fall back to most recent
        let validObjectiveSetting = null;
        
        if (objectiveSettings && objectiveSettings.length > 0) {
            // First try to find objective setting for the selected year
            validObjectiveSetting = objectiveSettings.find(setting => 
                setting.performancePeriodYear === parseInt(selectedYear)
            );
            
            // If no setting found for selected year, use the most recent one
            if (!validObjectiveSetting) {
                validObjectiveSetting = objectiveSettings[0];
                console.log(`No objective setting found for year ${selectedYear}, using most recent from year ${validObjectiveSetting.performancePeriodYear}`);
            } else {
                console.log(`Found objective setting for year ${selectedYear}`);
            }
        }
        
        if (!validObjectiveSetting) {
            console.log('No objective settings found at all');
            return res.status(404).json({
                success: false,
                message: "No objectives found for this user. Please complete objective setting first."
            });
        }
        
        const objectiveSettingsId = validObjectiveSetting.objectiveSettingsId;
        console.log(`Using objectiveSettingsId: ${objectiveSettingsId}`);
        
        // 5. Get the actual objectives
        console.log('Fetching objectives...');
        const { data: objectives, error: objectivesError } = await supabase
            .from('objectivesettings_objectives')
            .select('*')
            .eq('objectiveSettingsId', objectiveSettingsId);
            
        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objectives."
            });
        }
        
        console.log(`Found ${objectives?.length || 0} objectives`);
        
        // 6. Get the feedback questions for objectives (only if feedback record exists)
        let objectiveQuestions = [];
        if (feedbackId) {
            console.log(`Fetching existing questions for feedbackId: ${feedbackId}...`);
            const { data: questions, error: objectiveQuestionsError } = await supabase
                .from('feedbacks_questions-objectives')
                .select(`
                    feedback_qObjectivesId,
                    objectiveId,
                    objectiveQualiQuestion,
                    ${feedbackIdField}
                `)
                .eq(feedbackIdField, feedbackId);
                
            if (!objectiveQuestionsError && questions) {
                objectiveQuestions = questions;
                console.log(`Found ${objectiveQuestions.length} existing questions for ${quarter}`);
            } else if (objectiveQuestionsError) {
                console.error('Error fetching objective questions:', objectiveQuestionsError);
                // Continue without questions rather than failing
            }
        }
        
        // 7. Combine objectives with their guide questions
        const objectivesWithQuestions = objectives.map(objective => {
            const question = objectiveQuestions.find(q => q.objectiveId === objective.objectiveId);
            return {
                ...objective,
                guideQuestion: question ? question.objectiveQualiQuestion : '',
                questionId: question ? question.feedback_qObjectivesId : null
            };
        });
        
        console.log(`Created ${objectivesWithQuestions.length} objectives with questions`);
        
        // 8. Get skills data
        console.log('Fetching job skills...');
        const { data: allSkills, error: allSkillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', jobId);
            
        if (allSkillsError) {
            console.error('Error fetching job skills:', allSkillsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving job skills data."
            });
        }
        
        // Separate hard and soft skills
        const hardSkills = allSkills ? allSkills.filter(skill => skill.jobReqSkillType === 'Hard') : [];
        const softSkills = allSkills ? allSkills.filter(skill => skill.jobReqSkillType === 'Soft') : [];
        
        console.log(`Found ${hardSkills.length} hard skills and ${softSkills.length} soft skills`);
        
        // 9. Prepare response data
        const responseData = {
            success: true,
            message: `${quarter} questionnaire data retrieved successfully`,
            quarter: quarter,
            feedbackId: feedbackId,
            startDate: startDate, // Will be null for new questionnaires
            endDate: endDate,     // Will be null for new questionnaires
            objectives: objectivesWithQuestions,
            hardSkills: hardSkills,
            softSkills: softSkills,
            isNewFeedback: !feedbackId,
            isViewOnly: isViewOnly,
            meta: {
                userId: userId,
                jobId: jobId,
                year: feedbackYear,
                objectiveSettingsYear: validObjectiveSetting.performancePeriodYear,
                dateCreated: feedbackData ? feedbackData.dateCreated : null
            }
        };
        
        console.log(`=== RESPONSE SUMMARY ===`);
        console.log(`Quarter: ${quarter}`);
        console.log(`FeedbackId: ${feedbackId || 'null'}`);
        console.log(`StartDate: ${startDate || 'null'}`);
        console.log(`EndDate: ${endDate || 'null'}`);
        console.log(`IsNewFeedback: ${!feedbackId}`);
        console.log(`IsViewOnly: ${isViewOnly}`);
        console.log(`ObjectiveSettingsYear: ${validObjectiveSetting.performancePeriodYear}`);
        console.log(`=== getFeedbackQuestionnaire END ===`);
        
        return res.status(200).json(responseData);
        
    } catch (error) {
        console.error('=== ERROR in getFeedbackQuestionnaire ===');
        console.error('Error details:', error);
        console.error('Stack trace:', error.stack);
        return res.status(500).json({
            success: false,
            message: "An unexpected error occurred while fetching questionnaire data.",
            error: error.message
        });
    }
},
    saveMidYearIDP: async function(req, res) {
        try {
            // Get the user ID from the route parameters or form submission
            const userId = req.params.userId || req.body.userId;
            console.log("Starting saveMidYearIDP for userId:", userId);
    
            if (!userId) {
                console.error("User ID is missing");
                return res.status(400).json({ success: false, message: "User ID is required" });
            }
    
            // Get all form fields from the request body
            const {
                profStrengths,
                profAreasForDevelopment,
                profActionsToTake,
                leaderStrengths,
                leaderAreasForDevelopment,
                leaderActionsToTake,
                nextRoleShortTerm,
                nextRoleLongTerm,
                nextRoleMobility
            } = req.body;
    
            console.log("Received form data:", req.body);
    
            // Check if there's already an entry for this user
            const { data: existingRecord, error: checkError } = await supabase
                .from("midyearidps")
                .select("midyearidpId")
                .eq("userId", userId)
                .single();
    
            if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
                console.error("Error checking for existing midyearidp:", checkError);
                return res.status(500).json({ success: false, message: "Error checking for existing record" });
            }
    
            let result;
            if (existingRecord) {
                // Update existing record
                console.log("Updating existing midyearidp record:", existingRecord.midyearidpId);
                const { data, error } = await supabase
                    .from("midyearidps")
                    .update({
                        profStrengths,
                        profAreasForDevelopment,
                        profActionsToTake,
                        leaderStrengths,
                        leaderAreasForDevelopment,
                        leaderActionsToTake,
                        nextRoleShortTerm,
                        nextRoleLongTerm,
                        nextRoleMobility
                    })
                    .eq("midyearidpId", existingRecord.midyearidpId);
    
                if (error) {
                    console.error("Error updating midyearidp:", error);
                    return res.status(500).json({ success: false, message: error.message });
                }
                
                result = data;
            } else {
                // Create new record
                console.log("Creating new midyearidp record for userId:", userId);
                const { data, error } = await supabase
                    .from("midyearidps")
                    .insert({
                        userId,
                        profStrengths,
                        profAreasForDevelopment,
                        profActionsToTake,
                        leaderStrengths,
                        leaderAreasForDevelopment,
                        leaderActionsToTake,
                        nextRoleShortTerm,
                        nextRoleLongTerm,
                        nextRoleMobility
                    })
                    .select();
    
                if (error) {
                    console.error("Error inserting midyearidp:", error);
                    return res.status(500).json({ success: false, message: error.message });
                }
                
                result = data;
            }
    
            console.log("Mid-Year IDP saved successfully:", result);
    
            // If it's an API request (AJAX), return JSON
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(200).json({ 
                    success: true, 
                    message: "Mid-Year IDP saved successfully" 
                });
            }
    
            // Otherwise, redirect to the user's records page with success message
            req.flash('success', 'Mid-Year IDP submitted successfully!');
            return res.redirect(`/linemanager/records-performance-tracker/${userId}`);
    
        } catch (error) {
            console.error("Error in saveMidYearIDP:", error);
            
            // If it's an API request (AJAX), return JSON error
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: "An error occurred while saving the Mid-Year IDP",
                    error: error.message 
                });
            }
    
            // Otherwise, redirect with error message
            req.flash('errors', { dbError: 'An error occurred while saving the Mid-Year IDP.' });
            return res.redirect(`/linemanager/midyear-idp/${req.params.userId || req.body.userId}`);
        }
    },

    // Aggregated Mid-Year Average 360 Degree Objective and Skills Feedback

    getMidYearFeedbackAggregates: async function(req, res) {
    try {
        const userId = req.params.userId;
        const selectedYear = req.query.year || new Date().getFullYear();
        
        console.log(`Fetching Mid-Year feedback aggregates for userId: ${userId}, year: ${selectedYear}`);
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required."
            });
        }
        
        // Get user's job information
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('jobId')
            .eq('userId', userId)
            .single();
            
        if (staffError || !staffData) {
            return res.status(404).json({
                success: false,
                message: "User job information not found."
            });
        }
        
        const jobId = staffData.jobId;
        
        // Get Q1 and Q2 feedback records
        const { data: q1Feedback, error: q1Error } = await supabase
            .from('feedbacks_Q1')
            .select('feedbackq1_Id')
            .eq('userId', userId)
            .eq('jobId', jobId)
            .eq('year', selectedYear)
            .maybeSingle();
            
        const { data: q2Feedback, error: q2Error } = await supabase
            .from('feedbacks_Q2')
            .select('feedbackq2_Id')
            .eq('userId', userId)
            .eq('jobId', jobId)
            .eq('year', selectedYear)
            .maybeSingle();
            
        if ((q1Error && q1Error.code !== 'PGRST116') || (q2Error && q2Error.code !== 'PGRST116')) {
            console.error('Error fetching feedback records:', { q1Error, q2Error });
            return res.status(500).json({
                success: false,
                message: "Error retrieving feedback records."
            });
        }
        
        // Initialize aggregated data structures
        const objectiveAggregates = [];
        const skillAggregates = [];
        
        // Process Q1 and Q2 feedback data
        const quarterData = [
            { quarter: 'Q1', feedbackId: q1Feedback?.feedbackq1_Id, idField: 'feedbackq1_Id' },
            { quarter: 'Q2', feedbackId: q2Feedback?.feedbackq2_Id, idField: 'feedbackq2_Id' }
        ];
        
        // Get objectives data first
        const { data: objectiveSettings, error: objSettingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId, performancePeriodYear')
            .eq('userId', userId)
            .order('created_at', { ascending: false });
            
        if (objSettingsError) {
            console.error('Error fetching objective settings:', objSettingsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objective settings."
            });
        }
        
        // Find objective setting for the selected year
        const validObjectiveSetting = objectiveSettings?.find(setting => 
            setting.performancePeriodYear === parseInt(selectedYear)
        ) || objectiveSettings?.[0];
        
        if (!validObjectiveSetting) {
            return res.status(404).json({
                success: false,
                message: "No objectives found for this user."
            });
        }
        
        // Get the actual objectives
        const { data: objectives, error: objectivesError } = await supabase
            .from('objectivesettings_objectives')
            .select('*')
            .eq('objectiveSettingsId', validObjectiveSetting.objectiveSettingsId);
            
        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objectives."
            });
        }
        
        // Get job skills
        const { data: allSkills, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', jobId);
            
        if (skillsError) {
            console.error('Error fetching skills:', skillsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving skills data."
            });
        }
        
        // Process each quarter's feedback
        for (const { quarter, feedbackId, idField } of quarterData) {
            if (!feedbackId) {
                console.log(`No ${quarter} feedback found, skipping...`);
                continue;
            }
            
            console.log(`Processing ${quarter} feedback with ID: ${feedbackId}`);
            
            // Process objectives for this quarter
            const { data: objectiveQuestions, error: objQuestionsError } = await supabase
                .from('feedbacks_questions-objectives')
                .select(`
                    feedback_qObjectivesId,
                    objectiveId,
                    ${idField}
                `)
                .eq(idField, feedbackId);
                
            if (!objQuestionsError && objectiveQuestions) {
                for (const objQuestion of objectiveQuestions) {
                    // Get answers for this objective question
                    const { data: answers, error: answersError } = await supabase
                        .from('feedbacks_answers-objectives')
                        .select('objectiveQuantInput')
                        .eq('feedback_qObjectivesId', objQuestion.feedback_qObjectivesId);
                        
                    if (!answersError && answers && answers.length > 0) {
                        // Calculate average rating
                        const validRatings = answers.filter(a => a.objectiveQuantInput).map(a => a.objectiveQuantInput);
                        if (validRatings.length > 0) {
                            const averageRating = validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
                            
                            // Find the objective details
                            const objective = objectives.find(obj => obj.objectiveId === objQuestion.objectiveId);
                            if (objective) {
                                // Check if this objective already exists in aggregates
                                let existingAggregate = objectiveAggregates.find(agg => agg.objectiveId === objective.objectiveId);
                                if (!existingAggregate) {
                                    existingAggregate = {
                                        objectiveId: objective.objectiveId,
                                        objectiveDescrpt: objective.objectiveDescrpt,
                                        objectiveKPI: objective.objectiveKPI,
                                        type: 'objective',
                                        quarterRatings: {},
                                        totalRating: 0,
                                        quarterCount: 0
                                    };
                                    objectiveAggregates.push(existingAggregate);
                                }
                                
                                existingAggregate.quarterRatings[quarter] = averageRating;
                                existingAggregate.totalRating += averageRating;
                                existingAggregate.quarterCount++;
                                existingAggregate.averageRating = existingAggregate.totalRating / existingAggregate.quarterCount;
                            }
                        }
                    }
                }
            }
            
            // Process skills for this quarter
            const { data: skillQuestions, error: skillQuestionsError } = await supabase
                .from('feedbacks_questions-skills')
                .select(`
                    feedback_qSkillsId,
                    jobReqSkillId,
                    ${idField}
                `)
                .eq(idField, feedbackId);
                
            if (!skillQuestionsError && skillQuestions) {
                for (const skillQuestion of skillQuestions) {
                    // Get answers for this skill question
                    const { data: answers, error: answersError } = await supabase
                        .from('feedbacks_answers-skills')
                        .select('skillsQuantInput')
                        .eq('feedback_qSkillsId', skillQuestion.feedback_qSkillsId);
                        
                    if (!answersError && answers && answers.length > 0) {
                        // Calculate average rating
                        const validRatings = answers.filter(a => a.skillsQuantInput).map(a => a.skillsQuantInput);
                        if (validRatings.length > 0) {
                            const averageRating = validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
                            
                            // Find the skill details
                            const skill = allSkills.find(s => s.jobReqSkillId === skillQuestion.jobReqSkillId);
                            if (skill) {
                                // Check if this skill already exists in aggregates
                                let existingAggregate = skillAggregates.find(agg => agg.jobReqSkillId === skill.jobReqSkillId);
                                if (!existingAggregate) {
                                    existingAggregate = {
                                        jobReqSkillId: skill.jobReqSkillId,
                                        jobReqSkillName: skill.jobReqSkillName,
                                        jobReqSkillType: skill.jobReqSkillType,
                                        type: 'skill',
                                        quarterRatings: {},
                                        totalRating: 0,
                                        quarterCount: 0
                                    };
                                    skillAggregates.push(existingAggregate);
                                }
                                
                                existingAggregate.quarterRatings[quarter] = averageRating;
                                existingAggregate.totalRating += averageRating;
                                existingAggregate.quarterCount++;
                                existingAggregate.averageRating = existingAggregate.totalRating / existingAggregate.quarterCount;
                            }
                        }
                    }
                }
            }
        }
        
        // Categorize feedback into rating groups
        const categorizedFeedback = {
            strengths: [], // 4-5 stars
            aboveAverage: [], // 4-5 stars (same as strengths for display purposes)
            average: [], // 3 stars
            belowAverage: [] // 1-2 stars
        };
        
        // Combine objectives and skills for categorization
        const allFeedbackItems = [...objectiveAggregates, ...skillAggregates];
        
        allFeedbackItems.forEach(item => {
            if (item.averageRating >= 4) {
                categorizedFeedback.strengths.push(item);
                categorizedFeedback.aboveAverage.push(item);
            } else if (item.averageRating >= 3) {
                categorizedFeedback.average.push(item);
            } else if (item.averageRating > 0) {
                categorizedFeedback.belowAverage.push(item);
            }
        });
        
        console.log('Categorized feedback summary:', {
            strengths: categorizedFeedback.strengths.length,
            average: categorizedFeedback.average.length,
            belowAverage: categorizedFeedback.belowAverage.length,
            totalProcessed: allFeedbackItems.length
        });
        
        return res.status(200).json({
            success: true,
            message: "Mid-Year feedback aggregates retrieved successfully",
            data: {
                objectives: objectiveAggregates,
                skills: skillAggregates,
                categorizedFeedback: categorizedFeedback,
                meta: {
                    userId: userId,
                    jobId: jobId,
                    year: selectedYear,
                    quarters: ['Q1', 'Q2'],
                    totalItems: allFeedbackItems.length
                }
            }
        });
        
    } catch (error) {
        console.error('Error in getMidYearFeedbackAggregates:', error);
        return res.status(500).json({
            success: false,
            message: "An unexpected error occurred while fetching Mid-Year feedback aggregates.",
            error: error.message
        });
    }
},

    saveFinalYearIDP: async function(req, res) {
        try {
            // Get the user ID from the route parameters or form submission
            const userId = req.params.userId || req.body.userId;
            console.log("Starting saveFinalYearIDP for userId:", userId);
    
            if (!userId) {
                console.error("User ID is missing");
                return res.status(400).json({ success: false, message: "User ID is required" });
            }
    
            // Get all form fields from the request body
            const {
                profStrengths,
                profAreasForDevelopment,
                profActionsToTake,
                leaderStrengths,
                leaderAreasForDevelopment,
                leaderActionsToTake,
                nextRoleShortTerm,
                nextRoleLongTerm,
                nextRoleMobility
            } = req.body;
    
            console.log("Received form data:", req.body);
    
            // Check if there's already an entry for this user
            const { data: existingRecord, error: checkError } = await supabase
                .from("finalyearidps")
                .select("finalyearidpId")
                .eq("userId", userId)
                .single();
    
            if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
                console.error("Error checking for existing finalyearidp:", checkError);
                return res.status(500).json({ success: false, message: "Error checking for existing record" });
            }
    
            let result;
            if (existingRecord) {
                // Update existing record
                console.log("Updating existing finalyearidp record:", existingRecord.finalyearidpId);
                const { data, error } = await supabase
                    .from("finalyearidps")
                    .update({
                        profStrengths,
                        profAreasForDevelopment,
                        profActionsToTake,
                        leaderStrengths,
                        leaderAreasForDevelopment,
                        leaderActionsToTake,
                        nextRoleShortTerm,
                        nextRoleLongTerm,
                        nextRoleMobility
                    })
                    .eq("finalyearidpId", existingRecord.finalyearidpId);
    
                if (error) {
                    console.error("Error updating finalyearidp:", error);
                    return res.status(500).json({ success: false, message: error.message });
                }
                
                result = data;
            } else {
                // Create new record
                console.log("Creating new finalyearidp record for userId:", userId);
                const { data, error } = await supabase
                    .from("finalyearidps")
                    .insert({
                        userId,
                        // Removed both jobId and year fields since they don't exist in the table
                        profStrengths,
                        profAreasForDevelopment,
                        profActionsToTake,
                        leaderStrengths,
                        leaderAreasForDevelopment,
                        leaderActionsToTake,
                        nextRoleShortTerm,
                        nextRoleLongTerm,
                        nextRoleMobility
                    })
                    .select();
    
                if (error) {
                    console.error("Error inserting finalyearidp:", error);
                    return res.status(500).json({ success: false, message: error.message });
                }
                
                result = data;
            }
    
            console.log("Final-Year IDP saved successfully:", result);
    
            // If it's an API request (AJAX), return JSON
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(200).json({ 
                    success: true, 
                    message: "Final-Year IDP saved successfully" 
                });
            }
    
            // Otherwise, redirect to the user's records page with success message
            req.flash('success', 'Final-Year IDP submitted successfully!');
            return res.redirect(`/linemanager/records-performance-tracker/${userId}`);
    
        } catch (error) {
            console.error("Error in saveFinalYearIDP:", error);
            
            // If it's an API request (AJAX), return JSON error
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: "An error occurred while saving the Final-Year IDP",
                    error: error.message 
                });
            }
    
            // Otherwise, redirect with error message
            req.flash('errors', { dbError: 'An error occurred while saving the Final-Year IDP.' });
            return res.redirect(`/linemanager/finalyear-idp/${req.params.userId || req.body.userId}`);
        }
    },

    getMidYearIDP: async function(req, res) {
        try {
            const userId = req.params.userId;
            console.log("Fetching Mid-Year IDP for userId:", userId);
    
            if (!userId) {
                console.error("User ID is missing");
                return res.status(400).json({ success: false, message: "User ID is required" });
            }
    
            // First, get user information
            const { data: userData, error: userError } = await supabase
                .from("useraccounts")
                .select(`
                    userId,
                    userEmail,
                    staffaccounts (
                        firstName,
                        lastName,
                        jobId,
                        departmentId,
                        departments (deptName),
                        jobpositions (jobTitle)
                    )
                `)
                .eq("userId", userId)
                .single();
    
            if (userError) {
                console.error("Error fetching user data:", userError);
                return res.status(500).json({ success: false, message: "Error fetching user data" });
            }
    
            // Then, get the Mid-Year IDP data
            const { data: midYearData, error: midYearError } = await supabase
                .from("midyearidps")
                .select("*")
                .eq("userId", userId)
                .single();
    
            if (midYearError && midYearError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
                console.error("Error fetching midyear IDP:", midYearError);
                return res.status(500).json({ success: false, message: "Error fetching midyear IDP data" });
            }
    
            // Format the user data
            const user = {
                userId: userData.userId,
                userEmail: userData.userEmail,
                firstName: userData.staffaccounts[0]?.firstName || "",
                lastName: userData.staffaccounts[0]?.lastName || "",
                jobTitle: userData.staffaccounts[0]?.jobpositions?.jobTitle || "",
                departmentName: userData.staffaccounts[0]?.departments?.deptName || ""
            };
    
            // Determine view state - whether to show form or view-only mode
            const viewState = {
                viewOnlyStatus: {
                    midyearidp: !!midYearData // true if midYearData exists, false otherwise
                },
                midYearData // Pass the data for view-only mode
            };
    
            // If it's an API request (AJAX), return JSON
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(200).json({ 
                    success: true, 
                    user,
                    viewState
                });
            }
    
            // Otherwise, render the midyear IDP page
            return res.render('staffpages/linemanager_pages/midyear-idp', { 
                user,
                viewState
            });
    
        } catch (error) {
            console.error("Error in getMidYearIDP:", error);
            
            // If it's an API request (AJAX), return JSON error
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: "An error occurred while fetching the Mid-Year IDP",
                    error: error.message 
                });
            }
    
            // Otherwise, redirect with error message
            req.flash('errors', { dbError: 'An error occurred while loading the Mid-Year IDP.' });
            return res.redirect('/linemanager/records-performance-tracker');
        }
    },

    getFinalYearIDP: async function(req, res) {
        try {
            const userId = req.params.userId;
            console.log("Fetching Final-Year IDP for userId:", userId);
    
            if (!userId) {
                console.error("User ID is missing");
                return res.status(400).json({ success: false, message: "User ID is required" });
            }
    
            // First, get user information
            const { data: userData, error: userError } = await supabase
                .from("useraccounts")
                .select(`
                    userId,
                    userEmail,
                    staffaccounts (
                        firstName,
                        lastName,
                        departmentId,
                        departments (deptName),
                        jobpositions (jobTitle)
                    )
                `)
                .eq("userId", userId)
                .single();
    
            if (userError) {
                console.error("Error fetching user data:", userError);
                return res.status(500).json({ success: false, message: "Error fetching user data" });
            }
    
            // Then, get the Final-Year IDP data - without filtering by job or year
            const { data: finalYearData, error: finalYearError } = await supabase
                .from("finalyearidps")
                .select("*")
                .eq("userId", userId)
                .single();
    
            if (finalYearError && finalYearError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
                console.error("Error fetching finalyear IDP:", finalYearError);
                return res.status(500).json({ success: false, message: "Error fetching finalyear IDP data" });
            }
    
            // Format the user data
            const user = {
                userId: userData.userId,
                userEmail: userData.userEmail,
                firstName: userData.staffaccounts[0]?.firstName || "",
                lastName: userData.staffaccounts[0]?.lastName || "",
                jobTitle: userData.staffaccounts[0]?.jobpositions?.jobTitle || "",
                departmentName: userData.staffaccounts[0]?.departments?.deptName || ""
                // Removed jobId from the user object
            };
    
            // Determine view state - whether to show form or view-only mode
            const viewState = {
                viewOnlyStatus: {
                    finalyearidp: !!finalYearData // true if finalYearData exists, false otherwise
                },
                finalYearData // Pass the data for view-only mode
            };
    
            // If it's an API request (AJAX), return JSON
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(200).json({ 
                    success: true, 
                    user,
                    viewState
                });
            }
    
            // Otherwise, render the finalyear IDP page
            return res.render('staffpages/linemanager_pages/finalyear-idp', { 
                user,
                viewState
            });
    
        } catch (error) {
            console.error("Error in getFinalYearIDP:", error);
            
            // If it's an API request (AJAX), return JSON error
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: "An error occurred while fetching the Final-Year IDP",
                    error: error.message 
                });
            }
    
            // Otherwise, redirect with error message
            req.flash('errors', { dbError: 'An error occurred while loading the Final-Year IDP.' });
            return res.redirect('/linemanager/records-performance-tracker');
        }
    },

    getFinalYearFeedbackAggregates: async function(req, res) {
    try {
        const userId = req.params.userId;
        const selectedYear = req.query.year || new Date().getFullYear();
        
        console.log(`Fetching Final-Year feedback aggregates for userId: ${userId}, year: ${selectedYear}`);
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required."
            });
        }
        
        // Get user's job information
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('jobId')
            .eq('userId', userId)
            .single();
            
        if (staffError || !staffData) {
            return res.status(404).json({
                success: false,
                message: "User job information not found."
            });
        }
        
        const jobId = staffData.jobId;
        
        // Get ALL four quarters' feedback records
        const quarterPromises = [
            supabase.from('feedbacks_Q1').select('feedbackq1_Id').eq('userId', userId).eq('jobId', jobId).eq('year', selectedYear).maybeSingle(),
            supabase.from('feedbacks_Q2').select('feedbackq2_Id').eq('userId', userId).eq('jobId', jobId).eq('year', selectedYear).maybeSingle(),
            supabase.from('feedbacks_Q3').select('feedbackq3_Id').eq('userId', userId).eq('jobId', jobId).eq('year', selectedYear).maybeSingle(),
            supabase.from('feedbacks_Q4').select('feedbackq4_Id').eq('userId', userId).eq('jobId', jobId).eq('year', selectedYear).maybeSingle()
        ];
        
        const quarterResults = await Promise.all(quarterPromises);
        
        // Check for errors in any quarter
        for (let i = 0; i < quarterResults.length; i++) {
            const { error } = quarterResults[i];
            if (error && error.code !== 'PGRST116') {
                console.error(`Error fetching Q${i+1} feedback:`, error);
                return res.status(500).json({
                    success: false,
                    message: `Error retrieving Q${i+1} feedback records.`
                });
            }
        }
        
        // Initialize aggregated data structures
        const objectiveAggregates = [];
        const skillAggregates = [];
        
        // Process all four quarters' feedback data
        const quarterData = [
            { quarter: 'Q1', feedbackId: quarterResults[0].data?.feedbackq1_Id, idField: 'feedbackq1_Id' },
            { quarter: 'Q2', feedbackId: quarterResults[1].data?.feedbackq2_Id, idField: 'feedbackq2_Id' },
            { quarter: 'Q3', feedbackId: quarterResults[2].data?.feedbackq3_Id, idField: 'feedbackq3_Id' },
            { quarter: 'Q4', feedbackId: quarterResults[3].data?.feedbackq4_Id, idField: 'feedbackq4_Id' }
        ];
        
        // Get objectives data
        const { data: objectiveSettings, error: objSettingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId, performancePeriodYear')
            .eq('userId', userId)
            .order('created_at', { ascending: false });
            
        if (objSettingsError) {
            console.error('Error fetching objective settings:', objSettingsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objective settings."
            });
        }
        
        // Find objective setting for the selected year
        const validObjectiveSetting = objectiveSettings?.find(setting => 
            setting.performancePeriodYear === parseInt(selectedYear)
        ) || objectiveSettings?.[0];
        
        if (!validObjectiveSetting) {
            return res.status(404).json({
                success: false,
                message: "No objectives found for this user."
            });
        }
        
        // Get the actual objectives
        const { data: objectives, error: objectivesError } = await supabase
            .from('objectivesettings_objectives')
            .select('*')
            .eq('objectiveSettingsId', validObjectiveSetting.objectiveSettingsId);
            
        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objectives."
            });
        }
        
        // Get job skills
        const { data: allSkills, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', jobId);
            
        if (skillsError) {
            console.error('Error fetching skills:', skillsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving skills data."
            });
        }
        
        // Process each quarter's feedback
        for (const { quarter, feedbackId, idField } of quarterData) {
            if (!feedbackId) {
                console.log(`No ${quarter} feedback found, skipping...`);
                continue;
            }
            
            console.log(`Processing ${quarter} feedback with ID: ${feedbackId}`);
            
            // Process objectives for this quarter
            const { data: objectiveQuestions, error: objQuestionsError } = await supabase
                .from('feedbacks_questions-objectives')
                .select(`
                    feedback_qObjectivesId,
                    objectiveId,
                    ${idField}
                `)
                .eq(idField, feedbackId);
                
            if (!objQuestionsError && objectiveQuestions) {
                for (const objQuestion of objectiveQuestions) {
                    // Get answers for this objective question
                    const { data: answers, error: answersError } = await supabase
                        .from('feedbacks_answers-objectives')
                        .select('objectiveQuantInput')
                        .eq('feedback_qObjectivesId', objQuestion.feedback_qObjectivesId);
                        
                    if (!answersError && answers && answers.length > 0) {
                        // Calculate average rating
                        const validRatings = answers.filter(a => a.objectiveQuantInput).map(a => a.objectiveQuantInput);
                        if (validRatings.length > 0) {
                            const averageRating = validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
                            
                            // Find the objective details
                            const objective = objectives.find(obj => obj.objectiveId === objQuestion.objectiveId);
                            if (objective) {
                                // Check if this objective already exists in aggregates
                                let existingAggregate = objectiveAggregates.find(agg => agg.objectiveId === objective.objectiveId);
                                if (!existingAggregate) {
                                    existingAggregate = {
                                        objectiveId: objective.objectiveId,
                                        objectiveDescrpt: objective.objectiveDescrpt,
                                        objectiveKPI: objective.objectiveKPI,
                                        type: 'objective',
                                        quarterRatings: {},
                                        totalRating: 0,
                                        quarterCount: 0
                                    };
                                    objectiveAggregates.push(existingAggregate);
                                }
                                
                                existingAggregate.quarterRatings[quarter] = averageRating;
                                existingAggregate.totalRating += averageRating;
                                existingAggregate.quarterCount++;
                                existingAggregate.averageRating = existingAggregate.totalRating / existingAggregate.quarterCount;
                            }
                        }
                    }
                }
            }
            
            // Process skills for this quarter
            const { data: skillQuestions, error: skillQuestionsError } = await supabase
                .from('feedbacks_questions-skills')
                .select(`
                    feedback_qSkillsId,
                    jobReqSkillId,
                    ${idField}
                `)
                .eq(idField, feedbackId);
                
            if (!skillQuestionsError && skillQuestions) {
                for (const skillQuestion of skillQuestions) {
                    // Get answers for this skill question
                    const { data: answers, error: answersError } = await supabase
                        .from('feedbacks_answers-skills')
                        .select('skillsQuantInput')
                        .eq('feedback_qSkillsId', skillQuestion.feedback_qSkillsId);
                        
                    if (!answersError && answers && answers.length > 0) {
                        // Calculate average rating
                        const validRatings = answers.filter(a => a.skillsQuantInput).map(a => a.skillsQuantInput);
                        if (validRatings.length > 0) {
                            const averageRating = validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
                            
                            // Find the skill details
                            const skill = allSkills.find(s => s.jobReqSkillId === skillQuestion.jobReqSkillId);
                            if (skill) {
                                // Check if this skill already exists in aggregates
                                let existingAggregate = skillAggregates.find(agg => agg.jobReqSkillId === skill.jobReqSkillId);
                                if (!existingAggregate) {
                                    existingAggregate = {
                                        jobReqSkillId: skill.jobReqSkillId,
                                        jobReqSkillName: skill.jobReqSkillName,
                                        jobReqSkillType: skill.jobReqSkillType,
                                        type: 'skill',
                                        quarterRatings: {},
                                        totalRating: 0,
                                        quarterCount: 0
                                    };
                                    skillAggregates.push(existingAggregate);
                                }
                                
                                existingAggregate.quarterRatings[quarter] = averageRating;
                                existingAggregate.totalRating += averageRating;
                                existingAggregate.quarterCount++;
                                existingAggregate.averageRating = existingAggregate.totalRating / existingAggregate.quarterCount;
                            }
                        }
                    }
                }
            }
        }
        
        // Categorize feedback into rating groups with more refined categories for year-end
        const categorizedFeedback = {
            excellent: [], // 4.5-5 stars
            good: [], // 3.5-4.4 stars
            satisfactory: [], // 2.5-3.4 stars
            needsImprovement: [], // 1.5-2.4 stars
            critical: [] // 0-1.4 stars
        };
        
        // Combine objectives and skills for categorization
        const allFeedbackItems = [...objectiveAggregates, ...skillAggregates];
        
        allFeedbackItems.forEach(item => {
            if (item.averageRating >= 4.5) {
                categorizedFeedback.excellent.push(item);
            } else if (item.averageRating >= 3.5) {
                categorizedFeedback.good.push(item);
            } else if (item.averageRating >= 2.5) {
                categorizedFeedback.satisfactory.push(item);
            } else if (item.averageRating >= 1.5) {
                categorizedFeedback.needsImprovement.push(item);
            } else if (item.averageRating > 0) {
                categorizedFeedback.critical.push(item);
            }
        });
        
        // Calculate progression insights (comparing Q1-Q2 vs Q3-Q4)
        const progressionInsights = calculateProgressionInsights(allFeedbackItems);
        
        console.log('Final-Year categorized feedback summary:', {
            excellent: categorizedFeedback.excellent.length,
            good: categorizedFeedback.good.length,
            satisfactory: categorizedFeedback.satisfactory.length,
            needsImprovement: categorizedFeedback.needsImprovement.length,
            critical: categorizedFeedback.critical.length,
            totalProcessed: allFeedbackItems.length
        });
        
        return res.status(200).json({
            success: true,
            message: "Final-Year feedback aggregates retrieved successfully",
            data: {
                objectives: objectiveAggregates,
                skills: skillAggregates,
                categorizedFeedback: categorizedFeedback,
                progressionInsights: progressionInsights,
                meta: {
                    userId: userId,
                    jobId: jobId,
                    year: selectedYear,
                    quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
                    totalItems: allFeedbackItems.length,
                    availableQuarters: quarterData.filter(q => q.feedbackId).map(q => q.quarter)
                }
            }
        });
        
    } catch (error) {
        console.error('Error in getFinalYearFeedbackAggregates:', error);
        return res.status(500).json({
            success: false,
            message: "An unexpected error occurred while fetching Final-Year feedback aggregates.",
            error: error.message
        });
    }
},

    
    // getUserProgressView: async function(req, res) {
    //     const user = req.user;
    //     console.log('Fetching records for userId:', user?.userId);
    
    //     if (!user) {
    //         req.flash('errors', { authError: 'Unauthorized. Please log in to access this view.' });
    //         return res.redirect('/staff/login');
    //     }
    
    //     try {
    //         const { data: jobData, error: jobError } = await supabase
    //             .from('staffaccounts')
    //             .select('jobId')
    //             .eq('userId', user.userId)
    //             .single();
    
    //         if (jobError || !jobData) {
    //             console.error('Error fetching jobId:', jobError);
    //             req.flash('errors', { fetchError: 'Error fetching job information. Please try again.' });
    //             return res.redirect('/linemanager/records-performance-tracker');
    //         }
    
    //         const jobId = jobData.jobId;
    //         console.log('Fetched jobId:', jobId);
    
    //         const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4'];
    //         const yearPromises = feedbackTables.map(table => 
    //             supabase.from(table).select('year')
    //         );
    
    //         const yearResults = await Promise.all(yearPromises);
    //         const allYears = yearResults.flatMap(result => result.data || []);
    //         const availableYears = [...new Set(allYears.map(year => year.year))].sort((a, b) => b - a);
    //         const selectedYear = req.query.year || new Date().getFullYear();
    
    //         const feedbackData = {};
    //         for (const table of feedbackTables) {
    //             const { data, error } = await supabase
    //                 .from(table)
    //                 .select('*')
    //                 .eq('userId', user.userId)
    //                 .eq('jobId', jobId)
    //                 .eq('year', selectedYear);
    
    //             if (error) {
    //                 console.error(`Error fetching feedback data from ${table}:`, error);
    //                 req.flash('errors', { fetchError: `Error fetching data for ${table}. Please try again.` });
    //                 return res.redirect('/linemanager/records-performance-tracker');
    //             }
    
    //             feedbackData[table] = data;
    //         }
    
    //         console.log("Feedback Data:", feedbackData);
    
    //         // Fetch objectives settings
    //         const { data: objectiveSettings, error: objectivesError } = await supabase
    //             .from('objectivesettings')
    //             .select('*')
    //             .eq('userId', user.userId);
    
    //         if (objectivesError) {
    //             console.error('Error fetching objectives settings:', objectivesError);
    //             req.flash('errors', { fetchError: 'Error fetching objectives settings. Please try again.' });
    //             return res.redirect('/linemanager/records-performance-tracker');
    //         }
    
    //         let submittedObjectives = [];
    //         let objectiveQuestions = [];
    
    //         if (objectiveSettings.length > 0) {
    //             const objectiveSettingsIds = objectiveSettings.map(setting => setting.objectiveSettingsId);
    
    //             // Fetch the actual objectives related to the settings
    //             const { data: objectivesData, error: objectivesFetchError } = await supabase
    //                 .from('objectivesettings_objectives')
    //                 .select('*')
    //                 .in('objectiveSettingsId', objectiveSettingsIds);
    
    //             if (objectivesFetchError) {
    //                 console.error('Error fetching objectives:', objectivesFetchError);
    //                 req.flash('errors', { fetchError: 'Error fetching objectives. Please try again.' });
    //                 return res.redirect('/linemanager/records-performance-tracker');
    //             }
    
    //             submittedObjectives = objectivesData;
    
    //             // Fetch questions related to the objectives
    //             const { data: objectiveQuestionData, error: questionError } = await supabase
    //                 .from('feedbacks_questions-objectives')
    //                 .select('objectiveId, objectiveQualiQuestion')
    //                 .in('objectiveId', submittedObjectives.map(obj => obj.objectiveId));
    
    //             if (questionError) {
    //                 console.error('Error fetching objective questions:', questionError);
    //                 req.flash('errors', { fetchError: 'Error fetching objective questions. Please try again.' });
    //                 return res.redirect('/linemanager/records-performance-tracker');
    //             }
    
    //             objectiveQuestions = objectiveQuestionData;
    //         }
    
    //         // Map the `objectiveQuestions` to `submittedObjectives`
    //         submittedObjectives = submittedObjectives.map(obj => {
    //             const questions = objectiveQuestions.filter(q => q.objectiveId === obj.objectiveId);
    //             return {
    //                 ...obj,
    //                 objectiveQualiQuestion: questions.length > 0 ? questions.map(q => q.objectiveQualiQuestion).join(', ') : 'No questions available'
    //             };
    //         });
    
    //         // Fetch job requirements skills based on jobId
    //         const { data: skillsData, error: skillsError } = await supabase
    //             .from('jobreqskills')
    //             .select('jobReqSkillType, jobReqSkillName')
    //             .eq('jobId', jobId);
    
    //         if (skillsError) {
    //             console.error('Error fetching job requirements skills:', skillsError);
    //             req.flash('errors', { fetchError: 'Error fetching skills data. Please try again.' });
    //             return res.redirect('/linemanager/records-performance-tracker');
    //         }
    
    //         // Classify skills into Hard and Soft
    //         const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
    //         const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];
    
    //         // Initialize viewState
    //         const viewState = {
    //             success: true,
    //             userId: user.userId,
    //             jobId,
    //             feedbacks: feedbackData,
    //             hardSkills,
    //             softSkills,
    //             objectiveQuestions,
    //             submittedObjectives,
    //             years: availableYears,
    //             selectedYear,
    //             viewOnlyStatus: {
    //                 objectivesettings: objectiveSettings.length > 0,
    //             },
    //         };
    
    //         console.log("View State:", viewState);
    
    //         res.render('staffpages/linemanager_pages/managerrecordsperftracker-user', { viewState, user });
    //     } catch (error) {
    //         console.error('Error fetching user progress:', error);
    //         req.flash('errors', { fetchError: 'Error fetching user progress. Please try again.' });
    //         res.redirect('/linemanager/records-performance-tracker');
    //     }
    // },
    
    saveObjectiveSettings: async function(req, res) {
        try {
            const userId = req.body.userId;
            console.log("User ID in saveObjectiveSettings:", userId);
    
            const { jobId, objectiveDescrpt, objectiveKPI, objectiveTarget, objectiveUOM, objectiveAssignedWeight } = req.body;
    
            console.log("Request body:", req.body);
    
            if (!userId) {
                console.log("User not authenticated");
                return res.status(401).json({ success: false, message: "User not authenticated" });
            }
    
            // Get the current year
            const performancePeriodYear = new Date().getFullYear(); // Just the year
    
            // Initialize completeJobId
            let completeJobId = jobId;
    
            // Fetch from staffaccounts if jobId is missing
            if (!jobId) {
                console.log("Fetching missing jobId from staffaccounts table");
    
                const { data: staffAccountData, error } = await supabase
                    .from("staffaccounts")
                    .select("jobId")
                    .eq("userId", userId)
                    .single();
    
                if (error) {
                    console.error("Error fetching jobId:", error.message);
                    return res.status(500).json({ success: false, message: error.message });
                }
    
                completeJobId = staffAccountData?.jobId || jobId; // Fallback to existing jobId if staffAccountData is not found
            }
    
            // Check if jobId is still missing after fetching
            if (!completeJobId) {
                return res.status(400).json({ success: false, message: "Unable to retrieve jobId. Please provide it or ensure your user account has this information." });
            }
    
            // Validate objectives format
            const objectives = [];
            if (req.body.objectiveDescrpt) {
                for (let i = 0; i < req.body.objectiveDescrpt.length; i++) {
                    if (
                        req.body.objectiveDescrpt[i] && 
                        req.body.objectiveKPI[i] && 
                        req.body.objectiveTarget[i] && 
                        req.body.objectiveUOM[i] && 
                        req.body.objectiveAssignedWeight[i]
                    ) {
                        // Normalize weight to a decimal
                        const weight = parseFloat(req.body.objectiveAssignedWeight[i]) / 100;
    
                        objectives.push({
                            description: req.body.objectiveDescrpt[i],
                            kpi: req.body.objectiveKPI[i],
                            target: req.body.objectiveTarget[i],
                            uom: req.body.objectiveUOM[i],
                            weight: weight // Store normalized weight
                        });
                    }
                }
            }
    
            if (objectives.length === 0) {
                return res.status(400).json({ success: false, message: "Invalid objectives data format" });
            }
    
            console.log("Inserting data into objectivesettings table for user:", userId);
    
            const { data: objectiveSettingsData, error: objectiveSettingsError } = await supabase
                .from("objectivesettings")
                .insert({
                    userId,
                    jobId: completeJobId,
                    performancePeriodYear // Store only the year
                })
                .select("objectiveSettingsId");
    
            if (objectiveSettingsError) {
                console.error("Error inserting into objectivesettings table:", objectiveSettingsError.message);
                return res.status(500).json({ success: false, message: objectiveSettingsError.message });
            }
    
            const objectiveSettingsId = objectiveSettingsData[0].objectiveSettingsId;
            console.log("Objective Settings Inserted:", objectiveSettingsId);
    
            // Insert associated objectives into objectivesettings_objectives
            const objectiveEntries = objectives.map(objective => ({
                objectiveSettingsId,
                objectiveDescrpt: objective.description,
                objectiveKPI: objective.kpi,
                objectiveTarget: objective.target,
                objectiveUOM: objective.uom,
                objectiveAssignedWeight: objective.weight
            }));
    
            const { error: objectivesInsertError } = await supabase
                .from("objectivesettings_objectives")
                .insert(objectiveEntries);
    
            if (objectivesInsertError) {
                console.error("Error inserting objectives:", objectivesInsertError.message);
                return res.status(500).json({ success: false, message: objectivesInsertError.message });
            }
    
            res.redirect(`/linemanager/records-performance-tracker/${userId}`);
        } catch (error) {
            console.error("Error saving objective settings:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    },    

 // Updated getFeedbackData method with fixed column name

getFeedbackData: async function(req, res) {
    try {
        const userId = req.params.userId;
        const quarter = req.query.quarter; // e.g., "Q1", "Q2", etc.
        
        if (!userId || !quarter) {
            return res.status(400).json({
                success: false, 
                message: "User ID and quarter are required."
            });
        }
        
        console.log(`Fetching ${quarter} feedback data for user ${userId}`);
        
        // 1. Determine which feedback table to query
        let feedbackTable, feedbackIdField;
        
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
            return res.status(400).json({
                success: false,
                message: "Invalid quarter specified."
            });
        }
        
        // 2. Get the feedback record for this user and quarter
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`
                ${feedbackIdField},
                userId,
                jobId,
                setStartDate,
                setEndDate,
                dateCreated,
                year,
                quarter
            `)
            .eq('userId', userId)
            .eq('quarter', quarter)
            .single();
            
        if (feedbackError) {
            console.error('Error fetching feedback data:', feedbackError);
            return res.status(404).json({
                success: false,
                message: `No ${quarter} feedback found for this user.`
            });
        }
        
        if (!feedbackData) {
            return res.status(404).json({
                success: false,
                message: `No ${quarter} feedback record found for this user.`
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        console.log(`Using feedbackId: ${feedbackId} for further queries`);

        const jobId = feedbackData.jobId;
        
        // If no feedbackId is found, return early
        if (!feedbackId) {
    console.error(`Feedback ID not found in feedback data for userId ${userId} in quarter ${quarter}`);
    return res.status(404).json({
        success: false,
        message: `Could not find feedback ID for this employee in ${quarter}`
    });
}
        // 3. Get the objective settings for this user
        const { data: objectiveSettings, error: objectivesSettingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId, performancePeriodYear')
            .eq('userId', userId)
            .eq('jobId', jobId)
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (objectivesSettingsError) {
            console.error('Error fetching objective settings:', objectivesSettingsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objective settings."
            });
        }
        
        if (!objectiveSettings || objectiveSettings.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No objectives found for this user."
            });
        }
        
        const objectiveSettingsId = objectiveSettings[0].objectiveSettingsId;
        
        // 4. Get the actual objectives
        const { data: objectives, error: objectivesError } = await supabase
            .from('objectivesettings_objectives')
            .select('*')
            .eq('objectiveSettingsId', objectiveSettingsId);
            
        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objectives."
            });
        }
        
        // 5. Get the feedback questions for objectives
        const { data: objectiveQuestionsMapping, error: objectiveQuestionsError } = await supabase
            .from('feedbacks_questions-objectives')
            .select(`
                feedback_qObjectivesId,
                objectiveId,
                objectiveQualiQuestion,
                ${feedbackIdField}
            `)
            .eq(feedbackIdField, feedbackId);
            
        if (objectiveQuestionsError) {
            console.error('Error fetching objective questions:', objectiveQuestionsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving objective questions."
            });
        }
        
        // 6. For each objective mapping, get actual answers
        const objectiveFeedback = [];
        
        for (const objective of objectives) {
            const mapping = objectiveQuestionsMapping.find(q => q.objectiveId === objective.objectiveId);
            
            if (!mapping) continue;
            
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-objectives')
                .select('objectiveQualInput, objectiveQuantInput, created_at')
                .eq('feedback_qObjectivesId', mapping.feedback_qObjectivesId);
                
            if (answersError) {
                console.error('Error fetching objective answers:', answersError);
                continue;
            }
            
            // Calculate average rating
            let totalRating = 0;
            let validRatings = 0;
            
            for (const answer of answers || []) {
                if (answer.objectiveQuantInput) {
                    totalRating += answer.objectiveQuantInput;
                    validRatings++;
                }
            }
            
            const averageRating = validRatings > 0 ? totalRating / validRatings : null;
            
            // Format comments
            const comments = (answers || []).map(answer => ({
                text: answer.objectiveQualInput || "No comment provided",
                submittedOn: answer.created_at,
                responderType: 'Anonymous' // You might want to add logic to determine responder type
            }));
            
            objectiveFeedback.push({
                ...objective,
                question: mapping.objectiveQualiQuestion,
                averageRating,
                comments: comments || []
            });
        }
        
        // 7. Get skills data
        const { data: skills, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', jobId);
            
        if (skillsError) {
            console.error('Error fetching skills:', skillsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving skills data."
            });
        }
        
        // 8. Get skill questions
        const { data: skillQuestionsMapping, error: skillQuestionsError } = await supabase
            .from('feedbacks_questions-skills')
            .select(`
                feedback_qSkillsId,
                jobReqSkillId,
                ${feedbackIdField}
            `)
            .eq(feedbackIdField, feedbackId);
            
        if (skillQuestionsError) {
            console.error('Error fetching skill questions:', skillQuestionsError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving skill questions."
            });
        }
        
        // 9. For each skill, get answers
        const skillsFeedback = [];
        
        for (const skill of skills || []) {
            const mapping = skillQuestionsMapping.find(q => q.jobReqSkillId === skill.jobReqSkillId);
            
            if (!mapping) continue;
            
            // FIXED: Column name corrected from skillQuantInput to skillsQuantInput
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-skills')
                .select('skillsQuantInput, created_at')
                .eq('feedback_qSkillsId', mapping.feedback_qSkillsId);
                
            if (answersError) {
                console.error('Error fetching skill answers:', answersError);
                continue;
            }
            
            // Calculate average rating
            let totalRating = 0;
            let validRatings = 0;
            
            // FIXED: Column name corrected from skillQuantInput to skillsQuantInput
            for (const answer of answers || []) {
                if (answer.skillsQuantInput) {
                    totalRating += answer.skillsQuantInput;
                    validRatings++;
                }
            }
            
            const averageRating = validRatings > 0 ? totalRating / validRatings : null;
            
            skillsFeedback.push({
                skillName: skill.jobReqSkillName,
                skillType: skill.jobReqSkillType,
                averageRating,
                responseCount: validRatings
            });
        }
        
        // 10. Build individual responder data for detailed view
        // This will be a simplified version as we don't have responder identification
        const individualAnswers = [];
        
        // Group answers by created_at timestamp to simulate individual responders
        const allObjectiveAnswers = [];
        const allSkillAnswers = [];
        
        // Get all objective answers
        for (const mapping of objectiveQuestionsMapping || []) {
            const { data: answers, error } = await supabase
                .from('feedbacks_answers-objectives')
                .select('*, feedbacks_questions-objectives!inner(objectiveId)')
                .eq('feedback_qObjectivesId', mapping.feedback_qObjectivesId);
                
            if (!error && answers) {
                allObjectiveAnswers.push(...answers);
            }
        }
        
        // Get all skill answers
        for (const mapping of skillQuestionsMapping || []) {
            const { data: answers, error } = await supabase
                .from('feedbacks_answers-skills')
                .select('*, feedbacks_questions-skills!inner(jobReqSkillId)')
                .eq('feedback_qSkillsId', mapping.feedback_qSkillsId);
                
            if (!error && answers) {
                allSkillAnswers.push(...answers);
            }
        }
        
        // Group by created_at (simplistic approach - in production you'd use a responder ID)
        const timestamps = new Set([
            ...allObjectiveAnswers.map(a => a.created_at),
            ...allSkillAnswers.map(a => a.created_at)
        ]);
        
        let responderCounter = 1;
        for (const timestamp of timestamps) {
            const objAnswers = allObjectiveAnswers.filter(a => a.created_at === timestamp);
            const skillAnswers = allSkillAnswers.filter(a => a.created_at === timestamp);
            
            // Format objective answers
            const formattedObjAnswers = objAnswers.map(answer => {
                const objective = objectives.find(o => o.objectiveId === answer['feedbacks_questions-objectives'].objectiveId);
                return {
                    objectiveName: objective?.objectiveDescrpt || 'Unknown Objective',
                    rating: answer.objectiveQuantInput,
                    comment: answer.objectiveQualInput
                };
            });
            
            // Format skill answers
            const formattedSkillRatings = {};
            
            // FIXED: Column name corrected from skillQuantInput to skillsQuantInput
            skillAnswers.forEach(answer => {
                const skillId = answer['feedbacks_questions-skills'].jobReqSkillId;
                const skill = skills.find(s => s.jobReqSkillId === skillId);
                if (skill) {
                    formattedSkillRatings[skill.jobReqSkillName] = answer.skillsQuantInput;
                }
            });
            
            individualAnswers.push({
                responderId: responderCounter++,
                responderType: 'Anonymous',
                submittedDate: timestamp,
                objectiveAnswers: formattedObjAnswers,
                skillRatings: formattedSkillRatings
            });
        }
        
        // 11. Build summary stats
        const totalResponses = individualAnswers.length;
        
        const totalRatingSum = objectiveFeedback.reduce((sum, obj) => 
            sum + (obj.averageRating || 0), 0);
        
        const averageRating = objectiveFeedback.length > 0 ? 
            totalRatingSum / objectiveFeedback.length : 0;
        
        // For completion rate, we would need to know how many people were supposed to respond
        // For now, we'll calculate a percentage based on some assumptions
        const estimatedTotalRespondersExpected = 10; // Replace with actual logic if available
        const completionRate = Math.round((totalResponses / estimatedTotalRespondersExpected) * 100) + "%";
        
        // 12. Return the compiled data
        return res.status(200).json({
            success: true,
            stats: {
                totalResponses,
                averageRating: averageRating.toFixed(1),
                completionRate
            },
            objectiveFeedback,
            skillsFeedback,
            individualAnswers,
            meta: {
                feedbackId,
                quarter,
                startDate: feedbackData.setStartDate,
                endDate: feedbackData.setEndDate
            }
        });
        
    } catch (error) {
        console.error('Error in getFeedbackData:', error);
        return res.status(500).json({
            success: false,
            message: "An unexpected error occurred while fetching feedback data.",
            error: error.message
        });
    }
},
    save360Questionnaire: async function(req, res) {
        const { userId, startDate, endDate, jobId, feedbackData, quarter } = req.body;
    
        try {
            console.log("Entering save360DegreeFeedback function");
            console.log("User ID:", userId, "Request body:", req.body);
    
            // Step 1: Fetch the jobId if not provided
            let completeJobId = jobId;
            if (!completeJobId) {
                console.log("jobId is missing, fetching from staffaccounts...");
                const { data: staffAccountData, error } = await supabase
                    .from("staffaccounts")
                    .select("jobId")
                    .eq("userId", userId)
                    .single();
    
                if (error) {
                    console.error("Error fetching jobId:", error.message);
                    return res.status(500).json({ success: false, message: error.message });
                }
    
                if (!staffAccountData || !staffAccountData.jobId) {
                    console.error("No jobId found for the user.");
                    return res.status(400).json({ success: false, message: "Job ID not found for the user." });
                }
    
                completeJobId = staffAccountData.jobId;
                console.log("Fetched jobId:", completeJobId);
            }
    
            // Step 2: Validate required fields
            if (!completeJobId || !startDate || !endDate || !feedbackData || !feedbackData.questions.length || !quarter) {
                console.error('Validation error: Missing fields', { completeJobId, startDate, endDate, feedbackData, quarter });
                return res.status(400).json({ success: false, message: 'All fields are required.' });
            }
    
            // Determine the feedback table based on the quarter
            const feedbackTable = `feedbacks_${quarter}`;
            const feedbackKey = `feedback${quarter.toLowerCase()}_Id`;
    
            // Step 3: Check if feedback already exists
            const existingFeedback = await supabase
                .from(feedbackTable)
                .select('*')
                .eq('userId', userId)
                .eq('jobId', completeJobId)
                .eq('quarter', quarter)
                .eq('year', new Date().getFullYear())
                .single();
    
            let feedbackId;
            const dateCreated = new Date();
    
            if (existingFeedback.data) {
                console.log(`Updating existing feedback in ${feedbackTable}...`);
                const { error: updateError } = await supabase
                    .from(feedbackTable)
                    .update({
                        setStartDate: new Date(startDate),
                        setEndDate: new Date(endDate),
                        dateCreated: dateCreated,
                    })
                    .eq('userId', userId)
                    .eq('jobId', completeJobId)
                    .eq('quarter', quarter)
                    .eq('year', new Date().getFullYear());
    
                if (updateError) {
                    console.error(`Error updating feedback in ${feedbackTable}:`, updateError);
                    return res.status(500).json({ success: false, message: 'Error updating feedback. Please try again.', error: updateError });
                }
    
                feedbackId = existingFeedback.data[feedbackKey];
            } else {
                console.log(`Inserting new feedback into ${feedbackTable}...`);
                const { data: feedbackInsertData, error: feedbackInsertError } = await supabase
                    .from(feedbackTable)
                    .insert({
                        userId,
                        jobId: completeJobId,
                        setStartDate: new Date(startDate),
                        setEndDate: new Date(endDate),
                        dateCreated: dateCreated,
                        year: new Date().getFullYear(),
                        quarter: quarter
                    })
                    .select(feedbackKey);
    
                if (feedbackInsertError) {
                    console.error(`Error inserting into ${feedbackTable}:`, feedbackInsertError);
                    return res.status(500).json({ success: false, message: 'Error saving feedback. Please try again.', error: feedbackInsertError });
                }
    
                feedbackId = feedbackInsertData[0][feedbackKey];
            }
    
            // Step 4: Insert feedback mappings for questions
            for (const question of feedbackData.questions) {
                const { objectiveId, questionText } = question;
    
                const existingMapping = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('*')
                    .eq(feedbackKey, feedbackId)
                    .eq('objectiveId', objectiveId)
                    .single();
    
                if (!existingMapping.data) {
                    console.log(`Inserting mapping for objectiveId=${objectiveId}`);
                    const { error: mappingInsertError } = await supabase
                        .from('feedbacks_questions-objectives')
                        .insert({
                            [feedbackKey]: feedbackId,
                            objectiveId,
                            objectiveQualiQuestion: questionText
                        });
    
                    if (mappingInsertError) {
                        console.error(`Error inserting feedback mapping:`, mappingInsertError);
                        return res.status(500).json({ success: false, message: 'Error inserting feedback mapping.', error: mappingInsertError });
                    }
                }
            }
    
            // Step 5: Fetch and map jobReqSkills
            const { data: jobReqSkills, error: skillFetchError } = await supabase
                .from('jobreqskills')
                .select('jobReqSkillId')
                .eq('jobId', completeJobId);
    
            if (skillFetchError) {
                console.error("Error fetching jobReqSkills:", skillFetchError.message);
                return res.status(500).json({ success: false, message: "Error fetching job skills." });
            }
    
            if (jobReqSkills && jobReqSkills.length > 0) {
                console.log("Mapping skills to feedback...");
                for (const jobReqSkill of jobReqSkills) {
                    const { jobReqSkillId } = jobReqSkill;
    
                    const existingSkillMapping = await supabase
                        .from('feedbacks_questions-skills')
                        .select('*')
                        .eq(feedbackKey, feedbackId)
                        .eq('jobReqSkillId', jobReqSkillId)
                        .single();
    
                    if (!existingSkillMapping.data) {
                        console.log(`Inserting skill mapping for jobReqSkillId=${jobReqSkillId}`);
                        const { error: skillMappingInsertError } = await supabase
                            .from('feedbacks_questions-skills')
                            .insert({
                                [feedbackKey]: feedbackId,
                                jobReqSkillId
                            });
    
                        if (skillMappingInsertError) {
                            console.error("Error inserting skill mapping:", skillMappingInsertError);
                            return res.status(500).json({ success: false, message: "Error inserting skill mapping." });
                        }
                    }
                }
            } else {
                console.error('No jobReqSkills found for the job.');
            }
    
            return res.status(200).json({ success: true, message: 'Feedback saved successfully.' });
        } catch (error) {
            console.error('Error in save360DegreeFeedback:', error);
            return res.status(500).json({ success: false, message: 'An error occurred.', error: error.message });
        }
    },

    getOffboardingRequestsDash: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
    
            if (!userId || req.session.user.userRole !== 'Line Manager') {
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            // Fetch pending offboarding requests
            const { data: requests, error: requestsError } = await supabase
                .from('offboarding_requests')
                .select('requestId, userId, message, last_day, status, created_at')
                .eq('status', 'Pending Line Manager')
                .order('created_at', { ascending: false });
    
            if (requestsError) {
                console.error('Error fetching offboarding requests:', requestsError);
                req.flash('errors', { dbError: 'Failed to load offboarding requests.' });
                return res.redirect('/employee/dashboard');
            }
    
            if (!requests || requests.length === 0) {
                return res.render('staffpages/linemanager_pages/linemanageroffboarding', { requests: [] });
            }
    
            // Fetch employee names
            const userIds = requests.map(request => request.userId);
            const { data: staffAccounts, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName')
                .in('userId', userIds);
    
            if (staffError) {
                console.error('Error fetching staff accounts:', staffError);
                req.flash('errors', { dbError: 'Failed to load employee names.' });
                return res.redirect('/employee/dashboard');
            }
    
            // Combine offboarding requests with staff details
            const requestsWithNames = requests.map(request => {
                const staff = staffAccounts.find(staff => staff.userId === request.userId);
                return {
                    ...request,
                    staffName: staff ? `${staff.firstName} ${staff.lastName}` : 'Unknown'
                };
            });
    
            res.render('staffpages/linemanager_pages/linemanageroffboarding', { requests: requestsWithNames });
        } catch (err) {
            console.error('Error in getOffboardingRequestsDash controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading offboarding requests.' });
            res.redirect('/employee/dashboard');
        }
    },
    
    getViewOffboardingRequest: async function (req, res) {
        const userId = req.params.userId;
    
        if (!userId) {
            return res.redirect('/staff/login');
        }
    
        try {
            const { data: requests, error } = await supabase
                .from('offboarding_requests')
                .select('requestId, message, last_day')
                .eq('userId', userId)
                .order('requestId', { ascending: false })
                .limit(1);
    
            if (error) {
                console.error('Error fetching offboarding request:', error);
                return res.redirect('/linemanager/dashboard');
            }
    
            if (!requests || requests.length === 0) {
                console.log('No offboarding request found for userId:', userId);
                return res.redirect('/linemanager/dashboard');
            }
    
            // Fetch staff details
            const { data: staff, error: staffError } = await supabase
                .from('staffaccounts')
                .select('firstName, lastName')
                .eq('userId', userId)
                .single();
    
            if (staffError) {
                console.error('Error fetching staff details:', staffError);
                req.flash('errors', { dbError: 'Failed to load staff details.' });
                return res.redirect('/linemanager/dashboard');
            }
    
            res.render('staffpages/linemanager_pages/viewoffboardingrequest', {
                request: requests[0],
                staffName: staff ? `${staff.firstName} ${staff.lastName}` : 'Unknown'
            });
        } catch (err) {
            console.error('Error in getViewOffboardingRequest controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the offboarding request.' });
            return res.redirect('/linemanager/dashboard');
        }
    },
    
    updateOffboardingRequest: async function (req, res) {
        console.log("Received request body:", req.body);
        const { requestId, action, reason } = req.body;
    
        try {
            // Only the 'acceptResignation' action exists now
            if (action !== 'acceptResignation') {
                return res.status(400).json({ success: false, message: 'Invalid action.' });
            }
    
            if (!reason) {
                return res.status(400).json({ success: false, message: 'Approval notes are required.' });
            }
    
            const updateData = {
                status: 'Pending HR',  
                line_manager_notes: reason, 
                line_manager_decision: 'Approved',
                accept_resignation: true
            };
    
            console.log("Updating with data:", { updateData, requestId });
    
            const { data, error } = await supabase
                .from('offboarding_requests')
                .update(updateData)
                .eq('requestId', requestId);  // Update by requestId
    
            console.log("Supabase response:", { data, error });
    
            if (error) {
                console.error('Error updating offboarding request:', error);
                return res.status(500).json({ success: false, message: 'Failed to update request status.', error: error.message });
            }
    
            return res.status(200).json({ success: true, message: 'Resignation accepted successfully.' });
    
        } catch (err) {
            console.error('Error in updateOffboardingRequest:', err);
            return res.status(500).json({ success: false, message: 'An error occurred while processing the request.', error: err.message });
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

    // Add this new method to check feedback submission status
checkFeedbackStatus: async function(req, res) {
    const { userId, quarter } = req.query;
    const currentUserId = req.session?.user?.userId;
    
    if (!userId || !quarter || !currentUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters.'
        });
    }
    
    try {
        // Determine which feedback table to query based on quarter parameter
        let feedbackTable, feedbackIdField;
        
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
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid quarter specified.'
            });
        }
        
        // First get the feedback ID for this user
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`${feedbackIdField}, userId`)
            .eq('userId', userId)
            .single();
            
        if (feedbackError || !feedbackData) {
            return res.status(404).json({ 
                success: false, 
                message: 'No feedback record found for this user.'
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        
        // Check if the current user has submitted answers for this feedback
        // First check objectives feedback
        const { data: objectiveAnswers, error: objectiveError } = await supabase
            .from('feedbacks_answers-objectives')
            .select('feedback_answerObjectivesId')
            .eq('feedback_qObjectivesId', feedbackId)
            .limit(1);
            
        if (!objectiveError && objectiveAnswers && objectiveAnswers.length > 0) {
            // Feedback has been submitted for objectives
            return res.status(200).json({
                success: true,
                submitted: true,
                message: 'Feedback has been submitted for this user.'
            });
        }
        
        // If no objective answers found, check for skill answers
        const { data: skillAnswers, error: skillError } = await supabase
            .from('feedbacks_answers-skills')
            .select('feedback_answerSkillsId')
            .eq('feedback_qSkillsId', feedbackId)
            .limit(1);
            
        if (!skillError && skillAnswers && skillAnswers.length > 0) {
            // Feedback has been submitted for skills
            return res.status(200).json({
                success: true,
                submitted: true,
                message: 'Feedback has been submitted for this user.'
            });
        }
        
        // If no answers found in either table, feedback has not been submitted
        return res.status(200).json({
            success: true,
            submitted: false,
            message: 'Feedback has not yet been submitted for this user.'
        });
        
    } catch (error) {
        console.error('Error in checkFeedbackStatus:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while checking feedback status.', 
            error: error.message 
        });
    }
},

// Modify the submitFeedback method to properly store feedback answers
submitFeedback: async function(req, res) {
    const { userId, feedbackId, quarter, reviewerUserId, objectives, hardSkills, softSkills } = req.body;
    
    if (!userId || !feedbackId || !quarter || !reviewerUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters.' 
        });
    }
    
    try {
        // Determine which feedback table and field based on quarter
        let feedbackIdField;
        
        if (quarter === 'Q1') {
            feedbackIdField = 'feedbackq1_Id';
        } else if (quarter === 'Q2') {
            feedbackIdField = 'feedbackq2_Id';
        } else if (quarter === 'Q3') {
            feedbackIdField = 'feedbackq3_Id';
        } else if (quarter === 'Q4') {
            feedbackIdField = 'feedbackq4_Id';
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid quarter specified.' 
            });
        }
        
        // Process objectives feedback
        if (objectives && objectives.length > 0) {
            for (const objective of objectives) {
                const { objectiveId, quantitative, qualitative } = objective;
                
                // First get the feedback_qObjectivesId from the mapping table
                const { data: objectiveMapping, error: mappingError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('feedback_qObjectivesId')
                    .eq(feedbackIdField, feedbackId)
                    .eq('objectiveId', objectiveId)
                    .single();
                    
                if (mappingError || !objectiveMapping) {
                    console.error('Error finding objective mapping:', mappingError);
                    continue; // Skip this objective if mapping not found
                }
                
                // Insert the feedback answer
                const { error: insertError } = await supabase
                    .from('feedbacks_answers-objectives')
                    .insert({
                        feedback_qObjectivesId: objectiveMapping.feedback_qObjectivesId,
                        objectiveQualInput: qualitative,
                        objectiveQuantInput: parseInt(quantitative),
                        created_at: new Date()
                    });
                    
                if (insertError) {
                    console.error('Error inserting objective feedback:', insertError);
                }
            }
        }
        
        // Process hard skills feedback
        if (hardSkills && hardSkills.length > 0) {
            await processSkillsFeedback(hardSkills, feedbackId, feedbackIdField);
        }
        
        // Process soft skills feedback
        if (softSkills && softSkills.length > 0) {
            await processSkillsFeedback(softSkills, feedbackId, feedbackIdField);
        }
        
        return res.status(200).json({
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





/* ---------- NOTIFICATION DIVIDER ---------- */


getLeaveTypeName: async function(leaveTypeId) {
    try {
        // Query the leave types table to get the name
        const { data, error } = await supabase
            .from('leavetypes')
            .select('leaveTypeName')
            .eq('leaveTypeId', leaveTypeId)
            .single();
            
        if (error || !data) {
            console.log('Error getting leave type name:', error);
            return 'Leave';
        }
        
        return data.leaveTypeName || 'Leave';
    } catch (err) {
        console.error('Error in _getLeaveTypeName:', err);
        return 'Leave';
    }
},
getLineManagerNotifications: async function (req, res) {
    // Check for authentication
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get the line manager's department ID first
        const lineManagerId = req.session.user.userId;
        const { data: lineManagerData, error: lineManagerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerId)
            .single();

        if (lineManagerError) {
            console.error('Error fetching line manager department:', lineManagerError);
            throw lineManagerError;
        }

        const lineManagerDepartmentId = lineManagerData?.departmentId;

        if (!lineManagerDepartmentId) {
            console.error('Line manager has no department assigned');
            return res.status(400).json({ error: 'Department not assigned to your account' });
        }

        // Fetch applicants awaiting Line Manager action (P1 status) 
        // Filter applicants by the line manager's department
        const { data: p1Applicants, error: p1ApplicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
            .eq('applicantStatus', 'P1 - Awaiting for Line Manager Action; HR PASSED')
            .eq('departmentId', lineManagerDepartmentId) // Filter by department ID
            .order('created_at', { ascending: false });

        if (p1ApplicantsError) throw p1ApplicantsError;

        // Fetch applicants awaiting Line Manager evaluation (P3 status) 
        // Filter applicants by the line manager's department
        const { data: p3Applicants, error: p3ApplicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
            .eq('applicantStatus', 'P3 - Awaiting for Line Manager Evaluation')
            .eq('departmentId', lineManagerDepartmentId) // Filter by department ID
            .order('created_at', { ascending: false });

        if (p3ApplicantsError) throw p3ApplicantsError;

        // Combine the applicants
        const allApplicants = [...p1Applicants, ...p3Applicants];

        // Format the applicants data
        const formattedApplicants = allApplicants.map(applicant => ({
            id: applicant.applicantId,
            firstName: applicant.firstName || 'N/A',
            lastName: applicant.lastName || 'N/A',
            status: applicant.applicantStatus || 'N/A',
            jobId: applicant.jobId, // Include jobId for the redirect
            createdAt: applicant.created_at,
            formattedDate: new Date(applicant.created_at).toLocaleString('en-US', {
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit'
            })
        }));

        // Fetch pending leave requests for staff in the line manager's department
        const { data: leaveRequests, error: leaveError } = await supabase
            .from('leaverequests')
            .select(`
                leaveRequestId, 
                userId, 
                created_at, 
                fromDate, 
                untilDate, 
                status,
                useraccounts (
                    userId, 
                    userEmail,
                    staffaccounts (
                        departmentId,
                        departments (deptName), 
                        lastName, 
                        firstName
                    )
                ), 
                leave_types (
                    typeName
                )
            `)
            .eq('status', 'Pending')
            .order('created_at', { ascending: false });

        if (leaveError) throw leaveError;

        // Filter leave requests to only include those from the line manager's department
        const filteredLeaveRequests = leaveRequests.filter(leave => 
            leave.useraccounts?.staffaccounts[0]?.departmentId === lineManagerDepartmentId
        );

        // Format leave requests
        const formattedLeaveRequests = filteredLeaveRequests.map(leave => ({
            userId: leave.userId,
            lastName: leave.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
            firstName: leave.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
            department: leave.useraccounts?.staffaccounts[0]?.departments?.deptName || 'N/A',
            filedDate: new Date(leave.created_at).toLocaleString('en-US', {
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric'
            }),
            type: leave.leave_types?.typeName || 'N/A',
            startDate: leave.fromDate || 'N/A',
            endDate: leave.untilDate || 'N/A',
            status: leave.status || 'Pending'
        }));

        // Fetch pending offboarding/resignation requests
        const { data: offboardingRequests, error: offboardingError } = await supabase
            .from('offboarding_requests')
            .select(`
                requestId, 
                userId, 
                message, 
                last_day, 
                status, 
                created_at,
                useraccounts:userId (
                    staffaccounts (
                        firstName,
                        lastName,
                        departmentId
                    )
                )
            `)
            .eq('status', 'Pending Line Manager')
            .order('created_at', { ascending: false });

        if (offboardingError) {
            console.error('Error fetching offboarding requests:', offboardingError);
            throw offboardingError;
        }

        // Filter offboarding requests to only include those from the line manager's department
        const filteredOffboardingRequests = offboardingRequests.filter(request => 
            request.useraccounts?.staffaccounts[0]?.departmentId === lineManagerDepartmentId
        );

        // Format offboarding requests
        const formattedOffboardingRequests = filteredOffboardingRequests.map(request => ({
            requestId: request.requestId,
            userId: request.userId,
            lastName: request.useraccounts?.staffaccounts[0]?.lastName || 'N/A',
            firstName: request.useraccounts?.staffaccounts[0]?.firstName || 'N/A',
            message: request.message || 'N/A',
            lastDay: request.last_day || 'N/A',
            filedDate: new Date(request.created_at).toLocaleString('en-US', {
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric'
            }),
            status: request.status || 'Pending',
            type: 'Resignation Request'
        }));

const { data: trainingRequests, error: trainingError } = await supabase
    .from('training_records')
    .select(`
        trainingRecordId,
        userId,
        trainingId,
        dateRequested,
        isApproved,
        decisionDate,
        trainingStatus,
        useraccounts:userId (
            userEmail,
            staffaccounts (
                departmentId,
                firstName,
                lastName
            )
        ),
        trainings:trainingId (
            trainingName,
            trainingDesc
        )
    `)
    .is('isApproved', null) // Only get pending approvals
    .is('decisionDate', null) // Only get requests without decision date
    .not('trainingStatus', 'eq', 'cancelled') // Exclude cancelled requests
    .eq('useraccounts.staffaccounts.departmentId', lineManagerDepartmentId) // Filter by department
    .order('dateRequested', { ascending: true }); // Oldest first for priority

        if (trainingError) {
            console.error('Error fetching training requests:', trainingError);
            // Don't throw error - just log it and continue with empty array
        }

// In your getLineManagerNotifications function, update the training requests formatting:
const formattedTrainingRequests = (trainingRequests || []).map(request => ({
    userId: request.userId,
    trainingRecordId: request.trainingRecordId,
    firstName: request.useraccounts?.staffaccounts[0]?.firstName || request.useraccounts?.staffaccounts?.firstName || 'Employee',
    lastName: request.useraccounts?.staffaccounts[0]?.lastName || request.useraccounts?.staffaccounts?.lastName || '',
    trainingName: request.trainings?.trainingName || 'N/A',
    dateRequested: request.dateRequested ? new Date(request.dateRequested).toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }) : 'Recent',
    // Keep original date for frontend sorting
    date: request.dateRequested
}));
        // Calculate total notification count (now including training requests)
        const notificationCount = formattedApplicants.length + 
                                 formattedLeaveRequests.length + 
                                 formattedOffboardingRequests.length +
                                 formattedTrainingRequests.length;

        // If it's an API request, return JSON
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
            return res
                .header('Content-Type', 'application/json')
                .json({
                    applicants: formattedApplicants,
                    leaveRequests: formattedLeaveRequests,
                    offboardingRequests: formattedOffboardingRequests,
                    trainingRequests: formattedTrainingRequests, // Add training requests to response
                    notificationCount: notificationCount
                });
        }

        // Otherwise, return the rendered partial template
        return res.render('partials/linemanager_partials', {
            applicants: formattedApplicants,
            leaveRequests: formattedLeaveRequests,
            offboardingRequests: formattedOffboardingRequests,
            trainingRequests: formattedTrainingRequests, // Add training requests to template
            notificationCount: notificationCount
        });
    } catch (err) {
        console.error('Error fetching notification data:', err);
        
        // Better error handling for API requests
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
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

// Updated function to handle missing tables gracefully
get360FeedbackToast: async function(req, res) {
    try {
        console.log("Entering get360FeedbackToast function for line manager");

        // Step 1: Get today's date in the Philippines Time Zone (PHT)
        const today = new Date();
        const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(today);

        const todayString = `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;
        console.log(`Today's date (PHT): ${todayString}`);

        const feedbackTables = ['feedbacks_Q1', 'feedbacks_Q2', 'feedbacks_Q3', 'feedbacks_Q4']; 
        let activeFeedback = null;

        // Step 2: Fetch the current user's department ID
        const currentUserId = req.session?.user?.userId;

        if (!currentUserId) {
            console.log("Error: No user ID available in session.");
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        // Check if staffaccounts table exists and get department ID
        let departmentId;
        try {
            const { data: currentUserData, error: userError } = await supabase
                .from('staffaccounts')
                .select('departmentId')
                .eq('userId', currentUserId)
                .single();

            if (userError) {
                console.log("Error fetching user details:", userError);
                // If table doesn't exist, provide a fallback response
                if (userError.code === '42P01') { // Table doesn't exist
                    console.log("Staff accounts table does not exist yet");
                    return res.status(200).json({ 
                        success: true, 
                        feedback: {
                            setStartDate: new Date().toISOString(),
                            setEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
                            quarter: "Development"
                        }, 
                        quarter: "Development",
                        userId: currentUserId
                    });
                }
                return res.status(404).json({ success: false, message: 'User details not found.' });
            }

            if (!currentUserData) {
                console.log("No user data found");
                return res.status(404).json({ success: false, message: 'User details not found.' });
            }

            departmentId = currentUserData.departmentId;
        } catch (staffError) {
            console.error("Error accessing staff accounts:", staffError);
            // Return a development feedback in case tables are not set up
            return res.status(200).json({ 
                success: true, 
                feedback: {
                    setStartDate: new Date().toISOString(),
                    setEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
                    quarter: "Development"
                }, 
                quarter: "Development",
                userId: currentUserId
            });
        }

        // Step 3: Loop through each feedback table and fetch active feedback
        for (const feedbackTable of feedbackTables) {
            try {
                console.log(`Checking feedback table: ${feedbackTable}...`);

                // First check if the table exists
                const { error: tableCheckError } = await supabase
                    .from(feedbackTable)
                    .select('count')
                    .limit(1);

                if (tableCheckError && tableCheckError.code === '42P01') {
                    console.log(`Table ${feedbackTable} does not exist yet, skipping`);
                    continue;
                }

                const { data, error } = await supabase
                    .from(feedbackTable)
                    .select('*')
                    .lte('setStartDate', todayString) // Started today or earlier
                    .gte('setEndDate', todayString);  // Ends today or later

                if (error) {
                    console.log(`Error fetching data from ${feedbackTable}:`, error);
                    continue; 
                }

                if (data && data.length > 0) {
                    console.log(`Found ${data.length} active feedback entries in ${feedbackTable}`);

                    // Use the first active feedback found
                    activeFeedback = data[0];
                    const tableQuarter = feedbackTable.split('_')[1];
                    activeFeedback.quarter = tableQuarter;
                    break;
                } else {
                    console.log(`No active feedback found in ${feedbackTable}.`);
                }
            } catch (feedbackTableError) {
                // Log and continue to next table if there's an error
                console.log(`Error processing ${feedbackTable}:`, feedbackTableError);
            }
        }

        // Check if any active feedback record was found
        if (!activeFeedback) {
            console.log('No active feedback records found for the given date range.');
            return res.status(404).json({ 
                success: false, 
                message: 'No active feedback records found.' 
            });
        }

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


staffFeedbackList: async function (req, res) {
    console.log("staffFeedbackList function called for line manager!");
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
        // Fetch current user data (line manager)
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
        
        // Render the line manager feedback list page
        // Change this to use a line manager specific EJS template
        return res.render('staffpages/linemanager_pages/linemanager-quarterlyfeedbackquestionnaire.ejs', {
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


checkFeedbackStatus: async function(req, res) {
    const { userId, quarter } = req.query;
    const reviewerUserId = req.session?.user?.userId;
    
    if (!userId || !quarter || !reviewerUserId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameters'
        });
    }
    
    try {
        // Get the feedback ID first
        const feedbackIdField = 'feedbackq' + quarter.substring(1) + '_Id';
        
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(`feedbacks_${quarter}`)
            .select(`userId, ${feedbackIdField}`)
            .eq('userId', userId)
            .single();
            
        if (feedbackError || !feedbackData) {
            return res.status(404).json({
                success: false,
                message: 'Feedback data not found'
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        
        // Now check if the reviewer has already submitted feedback for this user
        const { data: reviewData, error: reviewError } = await supabase
            .from(`feedbacks_reviewer_${quarter}`)
            .select('reviewerId')
            .eq(`feedbackq${quarter.substring(1)}_Id`, feedbackId)
            .eq('reviewerId', reviewerUserId);
            
        if (reviewError) {
            return res.status(500).json({
                success: false,
                message: 'Error checking review status'
            });
        }
        
        // If review data exists, feedback has been submitted
        const submitted = reviewData && reviewData.length > 0;
        
        return res.json({
            success: true,
            submitted
        });
    } catch (error) {
        console.error('Error in checkFeedbackStatus:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while checking feedback status'
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

// ============================
// TRAINING MODULE CONTROLLER FUNCTIONS
// ============================

getTrainingFormData: async function(req, res) {
    console.log(`[${new Date().toISOString()}] User ${req.session?.user?.userId || 'unknown'} requesting training form data`);

    try {
        const userId = req.session?.user?.userId;
        
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        // Get the user's department from staffaccounts
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', userId)
            .single();

        if (staffError) {
            console.error('Error fetching staff account:', staffError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching user department information',
                error: staffError.message
            });
        }

        const userDepartmentId = staffAccount?.departmentId;
        console.log('Fetched userDepartmentId:', userDepartmentId);

        if (!userDepartmentId || isNaN(userDepartmentId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user department ID'
            });
        }

        // Fetch all job positions for the user's department
        const { data: jobPositionsData, error: jobPositionsError } = await supabase
            .from('jobpositions')
            .select('jobId, jobTitle, departmentId')
            .eq('departmentId', userDepartmentId)
            .order('jobTitle', { ascending: true });

        if (jobPositionsError) {
            console.error('Error fetching job positions:', jobPositionsError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching job positions',
                error: jobPositionsError.message
            });
        }

        const jobIds = jobPositionsData.map(job => job.jobId);

        // Corrected objectives query - removed staffaccounts join and will fetch separately
        const { data: objectivesData, error: objectivesError } = await supabase
            .from('objectivesettings_objectives')
            .select(`
                objectiveId, 
                objectiveDescrpt,
                objectivesettings!inner(
                    jobId,
                    userId,
                    jobpositions!inner(
                        jobTitle,
                        departmentId
                    )
                )
            `)
            .in('objectivesettings.jobId', jobIds)
            .order('objectiveDescrpt', { ascending: true });

        if (objectivesError) {
            console.error('Error fetching objectives:', objectivesError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching objectives',
                error: objectivesError.message
            });
        }

        // Get all unique user IDs from objectives to fetch their staff info
        const objectiveUserIds = [...new Set(objectivesData.map(obj => obj.objectivesettings.userId))];

        // Fetch staff accounts for these users in one query
        const { data: staffAccounts, error: staffAccountsError } = await supabase
            .from('staffaccounts')
            .select('userId, firstName, lastName')
            .in('userId', objectiveUserIds);

        if (staffAccountsError) {
            console.error('Error fetching staff accounts:', staffAccountsError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching staff information',
                error: staffAccountsError.message
            });
        }

        // Create a map of userId to staff info for quick lookup
        const staffMap = staffAccounts.reduce((acc, staff) => {
            acc[staff.userId] = staff;
            return acc;
        }, {});

        // Format the objectives data with staff information
        const objectives = objectivesData.map(obj => {
            const staffInfo = staffMap[obj.objectivesettings.userId] || {};
            return {
                objectiveId: obj.objectiveId,
                objectiveDescrpt: obj.objectiveDescrpt,
                jobId: obj.objectivesettings.jobId,
                jobTitle: obj.objectivesettings.jobpositions.jobTitle,
                firstName: staffInfo.firstName || 'Unknown',
                lastName: staffInfo.lastName || 'Unknown',
                staffName: `${staffInfo.firstName || 'Unknown'} ${staffInfo.lastName || ''}`.trim()
            };
        });

        // Rest of your code remains the same for skills and activity types...
        // Fetch job required skills where jobId is in the list of jobIds
        const { data: skillsData, error: skillsError } = await supabase
            .from('jobreqskills')
            .select(`
                jobReqSkillId, 
                jobReqSkillName, 
                jobReqSkillType,
                jobId,
                jobpositions!inner(
                    jobTitle,
                    departmentId
                )
            `)
            .in('jobId', jobIds)
            .order('jobReqSkillName', { ascending: true });

        if (skillsError) {
            console.error('Error fetching skills:', skillsError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching skills',
                error: skillsError.message
            });
        }

        // Fetch activity types
        const { data: activityTypesData, error: activityTypesError } = await supabase
            .from('training_activities_types')
            .select('activityTypeId, activityType')
            .order('activityType', { ascending: true });

        if (activityTypesError) {
            console.error('Error fetching activity types:', activityTypesError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching activity types',
                error: activityTypesError.message
            });
        }

        // Format the job positions data
        const jobPositions = jobPositionsData.map(job => ({
            jobId: job.jobId,
            jobTitle: job.jobTitle,
            departmentId: job.departmentId
        }));

        // Format and categorize skills data
        const skills = {
            all: skillsData.map(skill => ({
                jobReqSkillId: skill.jobReqSkillId,
                jobReqSkillName: skill.jobReqSkillName,
                jobReqSkillType: skill.jobReqSkillType,
                jobId: skill.jobId,
                jobTitle: skill.jobpositions.jobTitle,
                displayText: `${skill.jobReqSkillType} - ${skill.jobReqSkillName} (${skill.jobpositions.jobTitle})`
            })),
            hard: skillsData
                .filter(skill => skill.jobReqSkillType === 'Hard')
                .map(skill => ({
                    jobReqSkillId: skill.jobReqSkillId,
                    jobReqSkillName: skill.jobReqSkillName,
                    jobReqSkillType: skill.jobReqSkillType,
                    jobId: skill.jobId,
                    jobTitle: skill.jobpositions.jobTitle,
                    displayText: `${skill.jobReqSkillType} - ${skill.jobReqSkillName} (${skill.jobpositions.jobTitle})`
                })),
            soft: skillsData
                .filter(skill => skill.jobReqSkillType === 'Soft')
                .map(skill => ({
                    jobReqSkillId: skill.jobReqSkillId,
                    jobReqSkillName: skill.jobReqSkillName,
                    jobReqSkillType: skill.jobReqSkillType,
                    jobId: skill.jobId,
                    jobTitle: skill.jobpositions.jobTitle,
                    displayText: `${skill.jobReqSkillType} - ${skill.jobReqSkillName} (${skill.jobpositions.jobTitle})`
                }))
        };

        // Format activity types data
        const activityTypes = activityTypesData.map(type => ({
            id: type.activityTypeId,
            label: type.activityType
        }));

        console.log(`[${new Date().toISOString()}] Successfully fetched training form data for department ${userDepartmentId}`);

        return res.status(200).json({
            success: true,
            data: {
                jobPositions,
                objectives,
                skills,
                activityTypes
            },
            metadata: {
                timestamp: new Date().toISOString(),
                userDepartmentId: userDepartmentId,
                counts: {
                    jobPositions: jobPositions.length,
                    objectives: objectives.length,
                    totalSkills: skills.all.length,
                    hardSkills: skills.hard.length,
                    softSkills: skills.soft.length,
                    activityTypes: activityTypes.length
                }
            }
        });

    } catch (error) {
        console.error('Error in getTrainingFormData:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while fetching form data',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

createTraining: async function(req, res) {
    console.log(`[${new Date().toISOString()}] Creating new training for user ${req.session?.user?.userId}`);
    console.log('Request body:', req.body);

    const {
        trainingName,
        trainingDesc,
        jobId,
        objectives,        // Array of objective IDs
        skills,           // Array of skill IDs
        isOnlineArrangement,
        country,          // Country code for onsite training
        address,          // Address for onsite training
        cost,
        totalDuration,
        activities,
        certifications
    } = req.body;

    const userId = req.session?.user?.userId;

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: 'User not authenticated'
        });
    }

    try {
        // Validate required fields
        if (!trainingName || !trainingDesc || !jobId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: trainingName, trainingDesc, and jobId are required'
            });
        }

        // UPDATED VALIDATION: Allow either objectives OR skills (at least one from either)
        if ((!objectives || !Array.isArray(objectives) || objectives.length === 0) && 
            (!skills || !Array.isArray(skills) || skills.length === 0)) {
            return res.status(400).json({
                success: false,
                message: 'At least one objective OR one skill must be selected'
            });
        }

        // Validation: Check if onsite training has required location fields
        if (isOnlineArrangement === false) {
            if (!country || !address) {
                return res.status(400).json({
                    success: false,
                    message: 'Country and address are required for onsite training'
                });
            }
        }

        console.log('Selected objectives:', objectives);
        console.log('Selected skills:', skills);
        console.log('Training mode online:', isOnlineArrangement);
        console.log('Country:', country);
        console.log('Address:', address);

        // 1. Create the main training record in trainings table
        const trainingData = {
            trainingName,
            trainingDesc,
            jobId: parseInt(jobId),
            userId: userId,
            isOnlineArrangement: isOnlineArrangement || false,
            cost: parseFloat(cost) || 0,
            totalDuration: parseFloat(totalDuration) || 0,
            isActive: true
        };

        // Add country and address for onsite training
        if (isOnlineArrangement === false) {
            trainingData.country = country;
            trainingData.address = address;
        } else {
            // Set to null for online training
            trainingData.country = null;
            trainingData.address = null;
        }

        console.log('Training data to insert:', trainingData);

        const { data: training, error: trainingError } = await supabase
            .from('trainings')
            .insert([trainingData])
            .select()
            .single();

        if (trainingError) {
            console.error('Error creating training:', trainingError);
            throw new Error(`Failed to create training: ${trainingError.message}`);
        }

        const trainingId = training.trainingId;
        console.log(`Training created with ID: ${trainingId}`);

        // 2. Insert objectives into training_objectives table
        if (objectives && objectives.length > 0) {
            const formattedObjectives = objectives.map(objectiveId => ({
                trainingId: trainingId,
                objectiveId: parseInt(objectiveId)
            }));

            const { error: objectivesError } = await supabase
                .from('training_objectives')
                .insert(formattedObjectives);

            if (objectivesError) {
                console.error('Error inserting training objectives:', objectivesError);
                throw new Error(`Failed to create objectives: ${objectivesError.message}`);
            }
            console.log(`Created ${objectives.length} objectives for training`);
        }

        // 3. Insert skills into training_skills table
        if (skills && skills.length > 0) {
            const formattedSkills = skills.map(skillId => ({
                trainingId: trainingId,
                jobReqSkillId: parseInt(skillId)
            }));

            const { error: skillsError } = await supabase
                .from('training_skills')
                .insert(formattedSkills);

            if (skillsError) {
                console.error('Error inserting training skills:', skillsError);
                throw new Error(`Failed to create skills: ${skillsError.message}`);
            }
            console.log(`Created ${skills.length} skills for training`);
        }

        // 4. Insert activities into training_activities table
        if (activities && activities.length > 0) {
            const formattedActivities = activities.map((activity) => ({
                trainingId: trainingId,
                activityName: activity.name,
                estActivityDuration: parseFloat(activity.duration) || 0,
                activityType: activity.type,
                activityRemarks: activity.remarks || ''
            }));

            const { error: activitiesError } = await supabase
                .from('training_activities')
                .insert(formattedActivities);

            if (activitiesError) {
                console.error('Error inserting training activities:', activitiesError);
                throw new Error(`Failed to create activities: ${activitiesError.message}`);
            }
            console.log(`Created ${activities.length} activities for training`);
        }

        // 5. Insert certifications
        if (certifications && certifications.length > 0) {
            const formattedCerts = certifications.map(cert => ({
                trainingId: trainingId,
                trainingCertTitle: cert.title,
                trainingCertDesc: cert.description
            }));

            const { error: certsError } = await supabase
                .from('training_certifications')
                .insert(formattedCerts);

            if (certsError) {
                console.error('Error inserting training certifications:', certsError);
                throw new Error(`Failed to create certifications: ${certsError.message}`);
            }
            console.log(`Created ${certifications.length} certifications for training`);
        }

        // Return success response with created training data
        const responseData = {
            ...training,
            activityCount: activities ? activities.length : 0,
            certificationCount: certifications ? certifications.length : 0,
            selectedObjectives: objectives ? objectives.length : 0,
            selectedSkills: skills ? skills.length : 0
        };

        console.log(`[${new Date().toISOString()}] Training created successfully: ${trainingId}`);

        res.status(201).json({
            success: true,
            message: 'Training created successfully',
            data: responseData
        });

    } catch (error) {
        console.error('Error in createTraining:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create training',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
    // Add new activity type
    addActivityType: async function(req, res) {
        const { activityType } = req.body;

        try {
            const { data, error } = await supabase
                .from('training_activities_types')
                .insert([{ activityType }])
                .select()
                .single();

            if (error) throw error;

            res.json({
                success: true,
                message: 'Activity type added successfully',
                data: data
            });

        } catch (error) {
            console.error('Error in addActivityType:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to add activity type',
                error: error.message
            });
        }
    },

    // Fetch all trainings with related data
    getAllTrainings: async function(req, res) {
        try {
            const { data: trainings, error: trainingsError } = await supabase
                .from('trainings')
                .select(`
                    *,
                    jobpositions (jobTitle),
                    objectivesettings_objectives (objectiveName),
                    jobreqskills (skillName),
                    useraccounts (firstName, lastName),
                    training_activities (*),
                    training_certifications (*)
                `)
                .eq('isActive', true)
                .order('trainingId', { ascending: false });

            if (trainingsError) throw trainingsError;

            res.json({
                success: true,
                data: trainings
            });

        } catch (error) {
            console.error('Error in getAllTrainings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch trainings',
                error: error.message
            });
        }
    },

getTrainingRequestsForNotifications: async function(lineManagerUserId) {
    console.log(`[${new Date().toISOString()}] Fetching training requests for line manager ${lineManagerUserId}`);
    
    try {
        // First, get the line manager's department ID
        const { data: lineManagerData, error: lineManagerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerUserId)
            .single();

        if (lineManagerError) {
            console.error(`[${new Date().toISOString()}] Error fetching line manager department:`, lineManagerError);
            return [];
        }

        const lineManagerDepartmentId = lineManagerData?.departmentId;

        if (!lineManagerDepartmentId) {
            console.error(`[${new Date().toISOString()}] Line manager has no department assigned`);
            return [];
        }

        // Query to get training requests that need approval (isApproved = null)
        // Join with useraccounts and staffaccounts to get staff names and filter by department
        const { data: trainingRequests, error } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                userId,
                trainingId,
                dateRequested,
                isApproved,
                trainingStatus,
                useraccounts!inner(
                    userEmail,
                    staffaccounts!inner(
                        firstName,
                        lastName,
                        departmentId
                    )
                ),
                trainings!inner(
                    trainingName,
                    trainingDesc
                )
            `)
            .is('isApproved', null) // Only get pending approvals
            .not('trainingStatus', 'eq', 'cancelled') // Exclude cancelled requests
            .eq('useraccounts.staffaccounts.departmentId', lineManagerDepartmentId) // Filter by department
            .order('dateRequested', { ascending: true }); // Oldest first for priority

        if (error) {
            console.error(`[${new Date().toISOString()}] Error fetching training requests:`, error);
            return [];
        }

        // Transform the data to match frontend expectations
        const transformedRequests = trainingRequests.map(request => ({
            userId: request.userId,
            trainingRecordId: request.trainingRecordId,
            firstName: request.useraccounts.staffaccounts.firstName,
            lastName: request.useraccounts.staffaccounts.lastName,
            trainingName: request.trainings.trainingName,
            dateRequested: new Date(request.dateRequested).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            }),
            // Keep original date for frontend sorting
            date: request.dateRequested
        }));

        console.log(`[${new Date().toISOString()}] Found ${transformedRequests.length} pending training requests for department ${lineManagerDepartmentId}`);
        return transformedRequests;

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in getTrainingRequestsForNotifications:`, error);
        return [];
    }
},
getTrainingRequest: async function(req, res) {
    const userId = req.session?.user?.userId;
    const userRole = req.session?.user?.userRole;

    if (!userId || userRole !== 'Line Manager') {
        req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
        return res.redirect('/staff/login');
    }

    const requestUserId = req.params.userId;
    const recordId = req.query.recordId;

    console.log(`[${new Date().toISOString()}] Line manager ${userId} accessing training request view for user ${requestUserId}, record ${recordId}`);

    try {
        // If we have both userId and recordId, fetch the specific request data
        if (requestUserId && recordId) {
            const { data: trainingRequest, error } = await supabase
                .from('training_records')
                .select(`
                    *,
                    useraccounts!inner(
                        userEmail,
                        staffaccounts(
                            firstName,
                            lastName,
                            departmentId,
                            jobId
                        )
                    ),
                    trainings!inner(
                        trainingName,
                        trainingDesc,
                        cost,
                        totalDuration,
                        address,
                        country,
                        isOnlineArrangement
                    )
                `)
                .eq('userId', requestUserId)
                .eq('trainingRecordId', recordId)
                .is('isApproved', null)
                .single();

            if (error || !trainingRequest) {
                console.log(`[${new Date().toISOString()}] Training request not found or already processed`);
                req.flash('errors', { notFound: 'Training request not found or already processed.' });
                return res.redirect('/linemanager/dashboard');
            }

            // Render the view with the training request data
            res.render('staffpages/linemanager_pages/view-training-request', {
                trainingRequest,
                user: req.session.user,
                title: 'Training Request Review'
            });

        } else {
            // If missing parameters, just render the page (it will load data via AJAX)
            console.log(`[${new Date().toISOString()}] Rendering training request view page without pre-loaded data`);
            res.render('staffpages/linemanager_pages/view-training-request', {
                user: req.session.user,
                title: 'Training Request Review'
            });
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in getTrainingRequest:`, error);
        req.flash('errors', { serverError: 'Error loading training request.' });
        res.redirect('/linemanager/dashboard');
    }
},

getTrainingRequestsForNotifications: async function(lineManagerUserId) {
    console.log(`[${new Date().toISOString()}] Fetching training requests for line manager ${lineManagerUserId}`);
    
    try {
        // First, get the line manager's department ID
        const { data: lineManagerData, error: lineManagerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerUserId)
            .single();

        if (lineManagerError) {
            console.error(`[${new Date().toISOString()}] Error fetching line manager department:`, lineManagerError);
            return [];
        }

        const lineManagerDepartmentId = lineManagerData?.departmentId;

        if (!lineManagerDepartmentId) {
            console.error(`[${new Date().toISOString()}] Line manager has no department assigned`);
            return [];
        }

        // Query to get training requests that need approval (isApproved = null)
        // Join with useraccounts and staffaccounts to get staff names and filter by department
        const { data: trainingRequests, error } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                userId,
                trainingId,
                dateRequested,
                isApproved,
                trainingStatus,
                useraccounts!inner(
                    userEmail,
                    staffaccounts!inner(
                        firstName,
                        lastName,
                        departmentId
                    )
                ),
                trainings!inner(
                    trainingName,
                    trainingDesc
                )
            `)
            .is('isApproved', null) // Only get pending approvals
            .not('trainingStatus', 'eq', 'cancelled') // Exclude cancelled requests
            .eq('useraccounts.staffaccounts.departmentId', lineManagerDepartmentId) // Filter by department
            .order('dateRequested', { ascending: true }); // Oldest first for priority

        if (error) {
            console.error(`[${new Date().toISOString()}] Error fetching training requests:`, error);
            return [];
        }

        // Transform the data to match frontend expectations
        const transformedRequests = trainingRequests.map(request => ({
            userId: request.userId,
            trainingRecordId: request.trainingRecordId,
            firstName: request.useraccounts.staffaccounts.firstName,
            lastName: request.useraccounts.staffaccounts.lastName,
            trainingName: request.trainings.trainingName,
            dateRequested: new Date(request.dateRequested).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            }),
            // Keep original date for frontend sorting
            date: request.dateRequested
        }));

        console.log(`[${new Date().toISOString()}] Found ${transformedRequests.length} pending training requests for department ${lineManagerDepartmentId}`);
        return transformedRequests;

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in getTrainingRequestsForNotifications:`, error);
        return [];
    }
},

getTrainingRequestDetails: async function(req, res) {
    const userId = req.session?.user?.userId;
    const userRole = req.session?.user?.userRole;

    if (!userId || userRole !== 'Line Manager') {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized. Line Manager access only.',
            timestamp: new Date().toISOString()
        });
    }

    const requestUserId = req.params.userId;
    const recordId = req.query.recordId;

    console.log(`[${new Date().toISOString()}] Fetching training request details for user ${requestUserId}, record ${recordId}`);

    try {
        if (!requestUserId || !recordId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: userId and recordId',
                timestamp: new Date().toISOString()
            });
        }

        // Fetch the specific training request details with department and job position info
        const { data: trainingRequest, error } = await supabase
            .from('training_records')
            .select(`
                *,
                useraccounts!inner(
                    userEmail,
                    staffaccounts(
                        firstName,
                        lastName,
                        departmentId,
                        jobId,
                        departments(
                            deptName
                        ),
                        jobpositions(
                            jobTitle
                        )
                    )
                ),
                trainings!inner(
                    trainingName,
                    trainingDesc,
                    cost,
                    totalDuration,
                    address,
                    country,
                    isOnlineArrangement
                )
            `)
            .eq('userId', requestUserId)
            .eq('trainingRecordId', recordId)
            .is('isApproved', null)
            .single();

        if (error || !trainingRequest) {
            console.log(`[${new Date().toISOString()}] Training request not found:`, error?.message);
            return res.status(404).json({
                success: false,
                message: 'Training request not found or already processed.',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`[${new Date().toISOString()}] Successfully fetched training request details`);

        res.json({
            success: true,
            message: 'Training request details retrieved successfully',
            data: trainingRequest,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching training request:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch training request details',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

    // Approve training request
    approveTrainingRequest: async function(req, res) {
        const userId = req.session?.user?.userId;
        const userRole = req.session?.user?.userRole;

        if (!userId || userRole !== 'Line Manager') {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized. Line Manager access only.',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`[${new Date().toISOString()}] Line manager ${userId} approving training request`);

        try {
            const { remarks, trainingRecordId, userId: requestUserId } = req.body;

            if (!remarks || !remarks.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Remarks are required for approval',
                    timestamp: new Date().toISOString()
                });
            }

            if (!trainingRecordId) {
                return res.status(400).json({
                    success: false,
                    message: 'Training record ID is required',
                    timestamp: new Date().toISOString()
                });
            }

            const approvedDate = new Date().toISOString().split('T')[0]; // Today's date

            // Update the training record
            const { error } = await supabase
                .from('training_records')
                .update({
                    isApproved: true,
                    decisionDate: approvedDate,
                    decisionRemarks:remarks,
                    // Note: Add these fields to your table if you want to track approval details:
                    // approvalRemarks: remarks,
                    // approvedBy: userId
                })
                .eq('trainingRecordId', trainingRecordId)
                .is('isApproved', null); // Only update if still pending

            if (error) {
                console.error(`[${new Date().toISOString()}] Error approving training request:`, error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to approve training request',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }

            console.log(`[${new Date().toISOString()}] Training request ${trainingRecordId} approved successfully`);

            res.json({
                success: true,
                message: 'Training request approved successfully!',
                data: {
                    trainingRecordId,
                    status: 'approved',
                    approvedBy: userId,
                    approvedDate
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in training approval:`, error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during approval',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },

    // Reject training request
    rejectTrainingRequest: async function(req, res) {
        const userId = req.session?.user?.userId;
        const userRole = req.session?.user?.userRole;

        if (!userId || userRole !== 'Line Manager') {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized. Line Manager access only.',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`[${new Date().toISOString()}] Line manager ${userId} rejecting training request`);

        try {
            const { remarks, trainingRecordId, userId: requestUserId } = req.body;

            if (!remarks || !remarks.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Remarks are required for rejection',
                    timestamp: new Date().toISOString()
                });
            }

            if (!trainingRecordId) {
                return res.status(400).json({
                    success: false,
                    message: 'Training record ID is required',
                    timestamp: new Date().toISOString()
                });
            }

            const rejectedDate = new Date().toISOString().split('T')[0]; // Today's date

            // Update the training record
            const { error } = await supabase
                .from('training_records')
                .update({
                    isApproved: false,
                    decisionDate: rejectedDate,
                    decisionRemarks: remarks,
                    // Note: Add these fields to your table if you want to track rejection details:
                    // rejectionRemarks: remarks,
                    // rejectedBy: userId
                })
                .eq('trainingRecordId', trainingRecordId)
                .is('isApproved', null); // Only update if still pending

            if (error) {
                console.error(`[${new Date().toISOString()}] Error rejecting training request:`, error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to reject training request',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }

            console.log(`[${new Date().toISOString()}] Training request ${trainingRecordId} rejected successfully`);

            res.json({
                success: true,
                message: 'Training request rejected successfully!',
                data: {
                    trainingRecordId,
                    status: 'rejected',
                    rejectedBy: userId,
                    rejectedDate
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in training rejection:`, error);
            res.status(500).json({
                success: false,
                message: 'Internal server error during rejection',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    //  getTrainingRequestsForNotifications: function(req, res) {
    //      try {
    //     // Query to get training requests that need approval (isApproved = null)
    //     // Join with useraccounts to get staff names and trainings to get training details
    //     const { data: trainingRequests, error } = await supabase
    //         .from('training_records')
    //         .select(`
    //             trainingRecordId,
    //             userId,
    //             trainingId,
    //             dateRequested,
    //             isApproved,
    //             trainingStatus,
    //             useraccounts!inner(
    //                 firstName,
    //                 lastName,
    //                 userEmail
    //             ),
    //             trainings!inner(
    //                 trainingName,
    //                 trainingDesc
    //             )
    //         `)
    //         .is('isApproved', null) // Only get pending approvals
    //         .not('trainingStatus', 'eq', 'cancelled') // Exclude cancelled requests
    //         .order('dateRequested', { ascending: true }); // Oldest first for priority

    //     if (error) {
    //         console.error('Error fetching training requests:', error);
    //         return [];
    //     }

    //     // Transform the data to match frontend expectations
    //     const transformedRequests = trainingRequests.map(request => ({
    //         userId: request.userId,
    //         trainingRecordId: request.trainingRecordId,
    //         firstName: request.useraccounts.firstName,
    //         lastName: request.useraccounts.lastName,
    //         trainingName: request.trainings.trainingName,
    //         dateRequested: new Date(request.dateRequested).toLocaleDateString('en-US', {
    //             weekday: 'short',
    //             year: 'numeric',
    //             month: 'short',
    //             day: 'numeric'
    //         }),
    //         // Keep original date for frontend sorting
    //         date: request.dateRequested
    //     }));

    //     return transformedRequests;
    // } catch (error) {
    //     console.error('Error in getTrainingRequestsForNotifications:', error);
    //     return [];
    // }
    // },

    // getTrainingRequest: function(req, res) {

    //     try {
    //     if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
    //         req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
    //         return res.redirect('/staff/login');
    //     }

    //     const userId = req.params.userId;
    //     const recordId = req.query.recordId;

    //     // Fetch the specific training request details
    //     const { data: trainingRequest, error } = await supabase
    //         .from('training_records')
    //         .select(`
    //             *,
    //             useraccounts!inner(
    //                 firstName,
    //                 lastName,
    //                 userEmail,
    //                 staffaccounts(
    //                     department,
    //                     position
    //                 )
    //             ),
    //             trainings!inner(
    //                 trainingName,
    //                 trainingDesc,
    //                 cost,
    //                 totalDuration,
    //                 address,
    //                 country,
    //                 isOnlineArrangement
    //             )
    //         `)
    //         .eq('userId', userId)
    //         .eq('trainingRecordId', recordId)
    //         .is('isApproved', null)
    //         .single();

    //     if (error || !trainingRequest) {
    //         req.flash('errors', { notFound: 'Training request not found or already processed.' });
    //         return res.redirect('/linemanager/dashboard');
    //     }

    //     // Render the training request view page with the data
    //     res.render('staffpages/linemanager_pages/training_pages/view-trainingrequest', {
    //         trainingRequest,
    //         user: req.session.user
    //     });

    // } catch (error) {
    //     console.error('Error fetching training request:', error);
    //     req.flash('errors', { serverError: 'Error loading training request.' });
    //     res.redirect('/linemanager/dashboard');
    // }

    // },





    
};

module.exports = lineManagerController;
  // getSavedQuestionnaire: async function(req, res) {
    //     const { userId } = req.params; // Extract userId from request parameters
    //     const quarter = req.query.quarter; // Extract quarter from query parameters
    
    //     console.log('Received request to get saved questionnaire');
    //     console.log('User    ID:', userId);
    //     console.log('Quarter:', quarter);
    
    //     try {
    //         // Fetch feedbacks for the user
    //         console.log('Fetching feedback for userId:', userId);
    //         const { data: feedbackData, error: feedbackError } = await supabase
    //             .from('feedbacks')
    //             .select('*')
    //             .eq('userId', userId)
    //             .order('dateCreated', { ascending: false })
    //             .single(); // Assuming you want the latest feedback
    
    //         if (feedbackError) {
    //             console.error('Error fetching feedback:', feedbackError.message);
    //             return res.status(500).json({ success: false, message: 'Error fetching feedback. Please try again.' });
    //         }
    
    //         // Fetch objectives based on the feedback ID
    //         const { data: objectivesData, error: objectivesError } = await supabase
    //             .from('feedbacks_questions-objectives')
    //             .select('objectiveId, objectiveQualiQuestion')
    //             .eq('feedbackId', feedbackData.feedbackId);
    
    //         if (objectivesError) {
    //             console.error('Error fetching objectives:', objectivesError.message);
    //             return res.status(500).json({ success: false, message: 'Error fetching objectives. Please try again.' });
    //         }
    
    //         // Fetch skills based on the feedback ID
    //         const { data: skillsData, error: skillsError } = await supabase
    //             .from('feedbacks_questions-skills')
    //             .select('jobReqSkillId')
    //             .eq('feedbackId', feedbackData.feedbackId);
    
    //         if (skillsError) {
    //             console.error('Error fetching skills:', skillsError.message);
    //             return res.status(500).json({ success: false, message: 'Error fetching skills. Please try again.' });
    //         }
    
    //         // Structure the data for rendering
    //         const responseData = {
    //             feedback: {
    //                 question: feedbackData.question,
    //                 rating: feedbackData.rating,
    //                 qualitativeFeedback: feedbackData.qualitativeFeedback,
    //                 startDate: feedbackData.startDate,
    //                 endDate: feedbackData.endDate 
    //             },
    //             objectives: objectivesData.map(obj => ({
    //                 objectiveId: obj.objectiveId,
    //                 qualitativeQuestion: obj.objectiveQualiQuestion,
    //             })),
    //             skills: skillsData.map(skill => ({
    //                 jobReqSkillId: skill.jobReqSkillId,
    //             })),
    //         };
    
    //         // Return the structured data
    //         return res.json({ success: true, questionnaire: responseData });
    //     } catch (error) {
    //         console.error('Unexpected error:', error);
    //         return res.status(500).json({ success: false, message: 'An unexpected error occurred. Please try again.' });
    //     }
    // },
