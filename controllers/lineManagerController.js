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
        console.log('🚀 Loading Training Development Tracker...');
        console.log('User:', req.session?.user?.userId);
        
        // Fetch training records first
        const { data: trainingRecords, error: trainingError } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                userId,
                setStartDate,
                setEndDate,
                isApproved,
                dateRequested,
                jobId,
                created_at,
                trainingName,
                trainingDesc,
                cost,
                totalDuration,
                isOnlineArrangement,
                address,
                country,
                status,
                lmDecisionDate,
                lmDecisionRemarks,
                hrDecisionDate,
                hrDecisionRemarks,
                useraccounts!userId (
                    userEmail
                ),
                jobpositions!jobId (
                    jobTitle,
                    departmentId,
                    departments!departmentId (
                        deptName
                    )
                )
            `)
            .eq('status', 'For Line Manager Endorsement')
            .order('dateRequested', { ascending: false });

        if (trainingError) {
            console.error('❌ Error fetching training records:', trainingError);
            throw trainingError;
        }

        console.log('📋 Training records fetched:', trainingRecords?.length || 0);
        console.log('📋 Sample training record:', JSON.stringify(trainingRecords?.[0], null, 2));

        // Get unique userIds from training records
        const userIds = trainingRecords ? [...new Set(trainingRecords.map(record => record.userId))] : [];
        console.log('👥 User IDs from training records:', userIds);

        // Debug: Check what's in useraccounts for these userIds
        const { data: userAccountsCheck, error: userAccountsError } = await supabase
            .from('useraccounts')
            .select('userId, userEmail')
            .in('userId', userIds);

        if (userAccountsError) {
            console.error('❌ Error checking useraccounts:', userAccountsError);
        } else {
            console.log('👥 UserAccounts found:', JSON.stringify(userAccountsCheck, null, 2));
        }

        // Debug: Check what's in staffaccounts for these userIds
        const { data: staffAccountsCheck, error: staffAccountsError } = await supabase
            .from('staffaccounts')
            .select('userId, firstName, lastName')
            .in('userId', userIds);

        if (staffAccountsError) {
            console.error('❌ Error checking staffaccounts:', staffAccountsError);
        } else {
            console.log('👤 StaffAccounts found:', JSON.stringify(staffAccountsCheck, null, 2));
        }

        // Fetch staff names using the userIds
        let staffNames = [];
        if (userIds.length > 0) {
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName')
                .in('userId', userIds);

            if (staffError) {
                console.error('❌ Error fetching staff names:', staffError);
            } else {
                staffNames = staffData || [];
                console.log('📝 Staff names fetched:', staffNames?.length);
                console.log('📝 All staff names:', JSON.stringify(staffNames, null, 2));
            }
        }

        // Create lookup map
        const nameMap = {};
        staffNames.forEach(staff => {
            if (staff?.userId) {
                nameMap[staff.userId] = staff;
                console.log(`🗺️ Added to map: userId ${staff.userId} = ${staff.firstName} ${staff.lastName}`);
            }
        });

        console.log('🗺️ Name map keys:', Object.keys(nameMap));
        console.log('🗺️ Complete name map:', JSON.stringify(nameMap, null, 2));

        // Merge names with training records
        const trainingRecordsWithNames = trainingRecords ? trainingRecords.map(record => {
            const nameData = nameMap[record.userId];
            console.log(`🔗 Looking up userId ${record.userId}:`);
            console.log(`   - Found in map:`, nameData);
            
            const fullName = nameData ? 
                `${nameData.firstName || ''} ${nameData.lastName || ''}`.trim() : 
                'Name not found';
            
            console.log(`   - Final name: "${fullName}"`);
            
            return {
                ...record,
                staffaccounts: nameData || null,
                fullName: fullName
            };
        }) : [];

        console.log('📊 Final records with names:', trainingRecordsWithNames?.length);

        // Show first few records for debugging
        trainingRecordsWithNames.slice(0, 3).forEach((record, index) => {
            console.log(`📝 Record ${index + 1}:`);
            console.log(`   - Training ID: ${record.trainingRecordId}`);
            console.log(`   - User ID: ${record.userId}`);
            console.log(`   - Full Name: "${record.fullName}"`);
            console.log(`   - Has applicant data: ${!!record.applicantaccounts}`);
        });

        // ========================================
        // FETCH EMPLOYEES FROM SAME DEPARTMENT AS CURRENT LINE MANAGER
        // ========================================
        console.log('👥 Fetching employees from same department as line manager...');
        
        const currentUserId = req.session?.user?.userId;
        console.log('🔍 Current Line Manager ID from session:', currentUserId);
        console.log('🔍 Full session user data:', JSON.stringify(req.session?.user, null, 2));
        
        // First, get the current line manager's department
        const { data: currentManagerInfo, error: currentManagerError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                jobId,
                jobpositions!jobId (
                    jobTitle,
                    departmentId,
                    departments!departmentId (
                        deptName
                    )
                )
            `)
            .eq('userId', currentUserId)
            .single();

        if (currentManagerError) {
            console.error('❌ Error fetching current line manager info:', currentManagerError);
        } else {
            console.log('👤 Current line manager info:', JSON.stringify(currentManagerInfo, null, 2));
        }

        // Get the line manager's department ID
        const managerDepartmentId = currentManagerInfo?.jobpositions?.departmentId;
        const managerDepartmentName = currentManagerInfo?.jobpositions?.departments?.deptName;
        
        console.log('🏢 Line manager department ID:', managerDepartmentId);
        console.log('🏢 Line manager department name:', managerDepartmentName);

        let employees = [];
        let employeesError = null;

        if (managerDepartmentId) {
            console.log(`📋 Fetching employees from department: ${managerDepartmentName} (ID: ${managerDepartmentId})`);
            
            // Fetch all employees from the SAME DEPARTMENT as the line manager
            // ONLY show employees who have a position AND department assigned
            const result = await supabase
                .from('staffaccounts')
                .select(`
                    userId,
                    firstName,
                    lastName,
                    hireDate,
                    jobId,
                    useraccounts!userId (
                        userEmail
                    ),
                    jobpositions!jobId (
                        jobTitle,
                        departmentId,
                        departments!departmentId (
                            deptName
                        )
                    )
                `)
                .not('jobId', 'is', null) // Employee must have a job/position assigned
                .eq('jobpositions.departmentId', managerDepartmentId) // Same department as line manager
                .not('jobpositions.departmentId', 'is', null) // Position must have a department
                .neq('userId', currentUserId) // Exclude the line manager from the employee list
                .order('firstName', { ascending: true });
            
            employees = result.data;
            employeesError = result.error;
            
            console.log(`👥 Found ${employees?.length || 0} employees in department ${managerDepartmentName}`);
        } else {
            console.log('⚠️ Could not determine line manager\'s department');
            employees = [];
            employeesError = { message: 'Could not determine line manager department' };
        }

        // Alternative query if you don't have lineManagerId field (also removed isActive):
        // 
        // OPTION 2: If you have a specific way to determine line manager relationships
        // You might need to use a junction table or different logic here
        // 
        // OPTION 3: If line managers are determined by job roles/titles
        // const { data: employees, error: employeesError } = await supabase
        //     .from('staffaccounts')
        //     .select(`
        //         userId,
        //         firstName,
        //         lastName,
        //         hireDate,
        //         jobId,
        //         useraccounts!userId (
        //             userEmail
        //         ),
        //         jobpositions!jobId (
        //             jobTitle,
        //             departmentId,
        //             departments!departmentId (
        //                 deptName
        //             )
        //         )
        //     `)
        //     .eq('jobpositions.jobTitle', 'Employee') // Example: if you want to show only employees, not managers
        //     .order('firstName', { ascending: true });

        if (employeesError) {
            console.error('❌ Error fetching employees:', employeesError);
            // Don't throw error here, just log it and continue with empty employees array
        }

        // Process employees data - only include those with complete position/department info
        // AND fetch their latest training status
        const processedEmployees = employees ? await Promise.all(
            employees.filter(employee => {
                // Filter out employees without proper job/department data
                const hasJobTitle = employee.jobpositions?.jobTitle;
                const hasDepartment = employee.jobpositions?.departments?.deptName;
                const hasJobId = employee.jobId;
                
                if (!hasJobTitle || !hasDepartment || !hasJobId) {
                    console.log(`⚠️ Excluding employee ${employee.firstName} ${employee.lastName} - missing position/department data`);
                    return false;
                }
                
                return true;
            }).map(async (employee) => {
                // Fetch the latest training record for this employee
                const { data: latestTraining, error: trainingError } = await supabase
                    .from('training_records')
                    .select('status, dateRequested, trainingName')
                    .eq('userId', employee.userId)
                    .order('dateRequested', { ascending: false })
                    .limit(1);

                if (trainingError) {
                    console.error(`❌ Error fetching training for user ${employee.userId}:`, trainingError);
                }

                // Determine employee status based on latest training record
                let employeeStatus = 'No Training';
                let statusClass = 'status-no-training';
                let latestTrainingInfo = null;

                if (latestTraining && latestTraining.length > 0) {
                    const training = latestTraining[0];
                    employeeStatus = training.status;
                    latestTrainingInfo = {
                        trainingName: training.trainingName,
                        dateRequested: training.dateRequested
                    };

                    // Set CSS class based on status
                    switch (training.status) {
                        case 'For Line Manager Endorsement':
                            statusClass = 'status-pending-lm';
                            break;
                        case 'For HR Approval':
                            statusClass = 'status-pending-hr';
                            break;
                        case 'Cancelled':
                            statusClass = 'status-cancelled';
                            break;
                        case 'Not Started':
                            statusClass = 'status-not-started';
                            break;
                        case 'In Progress':
                            statusClass = 'status-in-progress';
                            break;
                        case 'Completed':
                            statusClass = 'status-completed';
                            break;
                        default:
                            statusClass = 'status-unknown';
                    }
                }

                console.log(`👤 Employee ${employee.firstName} ${employee.lastName} - Training Status: ${employeeStatus}`);

                return {
                    userId: employee.userId,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    userEmail: employee.useraccounts?.userEmail,
                    jobTitle: employee.jobpositions?.jobTitle,
                    departmentId: employee.jobpositions?.departmentId,
                    department: employee.jobpositions?.departments?.deptName,
                    hireDate: employee.hireDate,
                    trainingStatus: employeeStatus,
                    statusClass: statusClass,
                    latestTraining: latestTrainingInfo,
                    isActive: true // Keep this for UI compatibility
                };
            })
        ) : [];

        console.log('👥 Employees fetched:', processedEmployees?.length || 0);
        console.log('👥 Sample employee:', JSON.stringify(processedEmployees?.[0], null, 2));

        // ========================================
        // CALCULATE STATISTICS (Including Training Status Stats)
        // ========================================
        const totalPendingEndorsements = trainingRecordsWithNames?.length || 0;
        
        const trainingByType = {};
        const costSummary = {
            totalCost: 0,
            averageCost: 0,
            onlineTrainings: 0,
            onsiteTrainings: 0
        };

        // NEW: Training Status Statistics
        const statusStats = {
            forLineManagerEndorsement: 0,
            forHRApproval: 0,
            cancelled: 0,
            notStarted: 0,
            inProgress: 0,
            completed: 0,
            noTraining: 0
        };

        if (trainingRecordsWithNames) {
            trainingRecordsWithNames.forEach(record => {
                if (!trainingByType[record.trainingName]) {
                    trainingByType[record.trainingName] = 0;
                }
                trainingByType[record.trainingName]++;

                const cost = parseFloat(record.cost) || 0;
                costSummary.totalCost += cost;

                if (record.isOnlineArrangement) {
                    costSummary.onlineTrainings++;
                } else {
                    costSummary.onsiteTrainings++;
                }
            });
        }

        // Count status from processed employees (this includes all statuses)
        if (processedEmployees) {
            processedEmployees.forEach(employee => {
                switch (employee.trainingStatus) {
                    case 'For Line Manager Endorsement':
                        statusStats.forLineManagerEndorsement++;
                        break;
                    case 'For HR Approval':
                        statusStats.forHRApproval++;
                        break;
                    case 'Cancelled':
                        statusStats.cancelled++;
                        break;
                    case 'Not Started':
                        statusStats.notStarted++;
                        break;
                    case 'In Progress':
                        statusStats.inProgress++;
                        break;
                    case 'Completed':
                        statusStats.completed++;
                        break;
                    case 'No Training':
                        statusStats.noTraining++;
                        break;
                }
            });
        }

        costSummary.averageCost = totalPendingEndorsements > 0 
            ? (costSummary.totalCost / totalPendingEndorsements).toFixed(2)
            : 0;

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const { data: monthlyRequests, error: monthlyError } = await supabase
            .from('training_records')
            .select('dateRequested')
            .eq('status', 'For Line Manager Endorsement')
            .gte('dateRequested', sixMonthsAgo.toISOString());

        const monthlyTrends = {};
        if (monthlyRequests) {
            monthlyRequests.forEach(record => {
                const month = new Date(record.dateRequested).toISOString().substring(0, 7);
                monthlyTrends[month] = (monthlyTrends[month] || 0) + 1;
            });
        }

        const monthlyTrendsArray = Object.entries(monthlyTrends)
            .map(([month, count]) => ({ month, count }))
            .sort((a, b) => b.month.localeCompare(a.month));

        const statistics = {
            totalPendingEndorsements,
            trainingByType,
            costSummary,
            statusStats, // NEW: Add status statistics
            monthlyTrends: monthlyTrendsArray,
            totalEmployees: processedEmployees?.length || 0 // NEW: Total employees count
        };

        console.log('📊 Statistics calculated:', statistics);

        // ========================================
        // RENDER PAGE WITH ALL DATA
        // ========================================
        res.render('staffpages/linemanager_pages/trainingdevelopmenttracker', {
            title: 'Employee Training & Development Tracker',
            user: req.session?.user || null,
            trainingRecords: trainingRecordsWithNames || [],
            employees: processedEmployees || [], // Add employees data
            statistics: statistics
        });
        
        console.log('✅ Page rendered successfully');
        console.log(`📋 Final data summary:`);
        console.log(`   - Training Records: ${trainingRecordsWithNames?.length || 0}`);
        console.log(`   - Employees: ${processedEmployees?.length || 0}`);
        console.log(`   - Pending Endorsements: ${totalPendingEndorsements}`);
        
    } catch (error) {
        console.error('💥 ERROR in getTrainingDevelopmentTracker:', error);
        
        res.status(500).send(`
            <h1>Error Loading Training Tracker</h1>
            <p>There was an error loading the training development tracker.</p>
            <p>Error: ${error.message}</p>
            <div style="margin-top: 20px;">
                <a href="/linemanager/dashboard" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                    ← Return to Dashboard
                </a>
            </div>
        `);
    }
},

// Add this method to your line manager controller
getTrainingDetails: async function (req, res) {
    try {
        const { trainingRecordId } = req.params;
        console.log('🔍 Fetching training details for ID:', trainingRecordId);
        
        if (!trainingRecordId) {
            return res.status(400).json({
                success: false,
                error: 'Training Record ID is required'
            });
        }

        // Fetch comprehensive training details with all related data
        const { data: training, error: trainingError } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                userId,
                trainingName,
                trainingDesc,
                cost,
                totalDuration,
                isOnlineArrangement,
                address,
                country,
                status,
                dateRequested,
                setStartDate,
                setEndDate,
                lmDecisionDate,
                lmDecisionRemarks,
                hrDecisionDate,
                hrDecisionRemarks,
                isApproved,
                jobId,
                created_at,
                useraccounts!userId (
                    userEmail,
                    userRole
                ),
                jobpositions!jobId (
                    jobTitle,
                    departmentId,
                    departments!departmentId (
                        deptName
                    )
                )
            `)
            .eq('trainingRecordId', trainingRecordId)
            .single();

        if (trainingError) {
            console.error('❌ Error fetching training record:', trainingError);
            return res.status(404).json({
                success: false,
                error: 'Training record not found'
            });
        }

        console.log('📋 Training record found:', training.trainingName);

        // Fetch staff account details separately
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('userId, firstName, lastName')
            .eq('userId', training.userId)
            .single();

        if (staffError) {
            console.error('❌ Error fetching staff account:', staffError);
        }

        // Add staff account to training object
        training.staffaccounts = staffAccount || null;

        // Fetch training activities
        const { data: activities, error: activitiesError } = await supabase
            .from('training_records_activities')
            .select(`
                trainingRecordActivityId,
                activityName,
                activityRemarks,
                estActivityDuration,
                status,
                timestampzStarted,
                timestampzCompleted,
                created_at,
                activityTypeId,
                training_records_activities_types!activityTypeId (
                    activityType
                )
            `)
            .eq('trainingRecordId', trainingRecordId)
            .order('trainingRecordActivityId', { ascending: true });

        if (activitiesError) {
            console.error('❌ Error fetching activities:', activitiesError);
        }

        training.activities = activities || [];
        console.log(`📋 Found ${training.activities.length} activities`);

        // Fetch training skills
        const { data: skills, error: skillsError } = await supabase
            .from('training_records_skills')
            .select(`
                trainingRecordSkillId,
                jobReqSkillId,
                jobreqskills!jobReqSkillId (
                    jobReqSkillName,
                    jobReqSkillType
                )
            `)
            .eq('trainingRecordId', trainingRecordId);

        if (skillsError) {
            console.error('❌ Error fetching skills:', skillsError);
        }

        // Transform skills data
        training.skills = skills ? skills.map(skill => ({
            trainingRecordSkillId: skill.trainingRecordSkillId,
            jobReqSkillId: skill.jobReqSkillId,
            jobReqSkillName: skill.jobreqskills?.jobReqSkillName,
            jobReqSkillType: skill.jobreqskills?.jobReqSkillType
        })) : [];
        console.log(`📋 Found ${training.skills.length} skills`);

        // Fetch learning objectives
        const { data: objectives, error: objectivesError } = await supabase
            .from('training_records_objectives')
            .select(`
                trainingRecordObjectiveId,
                objectiveId,
                created_at,
                objectivesettings_objectives!objectiveId (
                    objectiveDescrpt
                )
            `)
            .eq('trainingRecordId', trainingRecordId)
            .order('trainingRecordObjectiveId', { ascending: true });

        if (objectivesError) {
            console.error('❌ Error fetching objectives:', objectivesError);
        }

        training.objectives = objectives || [];
        console.log(`📋 Found ${training.objectives.length} objectives`);

        // Fetch training categories
        const { data: categoryLinks, error: categoriesError } = await supabase
            .from('training_records_categories')
            .select(`
                trainingRecordCategoriesId,
                trainingCategoriesId,
                created_at,
                training_categories!trainingCategoriesId (
                    category
                )
            `)
            .eq('trainingRecordId', trainingRecordId);

        if (categoriesError) {
            console.error('❌ Error fetching categories:', categoriesError);
        }

        // Transform categories data
        training.categories = categoryLinks ? categoryLinks.map(cat => ({
            trainingRecordCategoriesId: cat.trainingRecordCategoriesId,
            trainingCategoriesId: cat.trainingCategoriesId,
            categoryName: cat.training_categories?.category || 'Unknown Category',
            categoryDesc: cat.training_categories?.category || 'No description'
        })) : [];
        console.log(`📋 Found ${training.categories.length} categories`);

        // Fetch certificates (if any)
        const { data: certificates, error: certificatesError } = await supabase
            .from('training_records_certificates')
            .select(`
                trainingRecordCertificateId,
                trainingCertTitle,
                trainingCertDesc,
                certificate_url,
                created_at
            `)
            .eq('trainingRecordId', trainingRecordId)
            .order('created_at', { ascending: false });

        if (certificatesError) {
            console.error('❌ Error fetching certificates:', certificatesError);
        }

        training.certificates = certificates || [];
        console.log(`📋 Found ${training.certificates.length} certificates`);

        console.log('✅ Training details fetched successfully');

        res.json({
            success: true,
            training: training
        });

    } catch (error) {
        console.error('💥 ERROR in getTrainingDetails:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
},
// 7. Here's your improved getEmployeeTrainingHistory function with better error handling:

getEmployeeTrainingHistory: async function (req, res) {
    try {
        const userId = req.params.userId;
        console.log('🔍 Fetching comprehensive training history for user:', userId);

        // Validate userId
        if (!userId) {
            return res.status(400).json({ 
                error: 'User ID is required',
                success: false 
            });
        }

        // Set proper JSON content type
        res.setHeader('Content-Type', 'application/json');

        // First, get employee basic info
        const { data: employee, error: employeeError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                useraccounts!userId (
                    userEmail
                ),
                jobpositions!jobId (
                    jobTitle,
                    departments!departmentId (
                        deptName
                    )
                )
            `)
            .eq('userId', userId)
            .single();

        if (employeeError) {
            console.error('❌ Error fetching employee info:', employeeError);
            return res.status(404).json({ 
                error: 'Employee not found',
                details: employeeError.message,
                success: false 
            });
        }

        if (!employee) {
            return res.status(404).json({ 
                error: 'Employee not found',
                success: false 
            });
        }

        console.log('👤 Employee found:', employee.firstName, employee.lastName);

        // Fetch all training records for this employee
        const { data: trainingRecords, error: trainingError } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                trainingName,
                trainingDesc,
                cost,
                totalDuration,
                isOnlineArrangement,
                address,
                country,
                status,
                dateRequested,
                setStartDate,
                setEndDate,
                lmDecisionDate,
                lmDecisionRemarks,
                hrDecisionDate,
                hrDecisionRemarks
            `)
            .eq('userId', userId)
            .order('dateRequested', { ascending: false });

        if (trainingError) {
            console.error('❌ Error fetching training records:', trainingError);
            return res.status(500).json({ 
                error: 'Error fetching training records',
                details: trainingError.message,
                success: false 
            });
        }

        console.log(`📋 Found ${trainingRecords?.length || 0} training records`);

        // For each training record, fetch all related data
        const comprehensiveTrainings = [];
        
        if (trainingRecords && trainingRecords.length > 0) {
            for (const training of trainingRecords) {
                try {
                    const trainingRecordId = training.trainingRecordId;
                    console.log(`🔍 Fetching details for training: ${training.trainingName} (ID: ${trainingRecordId})`);

                    // Fetch Activities (with error handling)
                    let activities = [];
                    try {
                        const { data: activitiesData, error: activitiesError } = await supabase
                            .from('training_records_activities')
                            .select(`
                                trainingRecordActivityId,
                                created_at,
                                timestampzStarted,
                                timestampzCompleted,
                                status,
                                activityName,
                                activityRemarks,
                                estActivityDuration,
                                training_records_activities_types!activityTypeId (
                                    activityType
                                )
                            `)
                            .eq('trainingRecordId', trainingRecordId);

                        if (!activitiesError) {
                            activities = activitiesData ? activitiesData.map(activity => ({
                                ...activity,
                                activityType: activity.training_records_activities_types?.activityType || 'Unknown'
                            })) : [];
                        }
                    } catch (err) {
                        console.error('⚠️ Error fetching activities, continuing...', err);
                    }

                    // Fetch Skills (with error handling)
                    let skills = [];
                    try {
                        const { data: skillsData, error: skillsError } = await supabase
                            .from('training_records_skills')
                            .select(`
                                trainingRecordSkillId,
                                created_at,
                                jobreqskills!jobReqSkillId (
                                    jobReqSkillName,
                                    jobReqSkillType
                                )
                            `)
                            .eq('trainingRecordId', trainingRecordId);

                        if (!skillsError) {
                            skills = skillsData ? skillsData.map(skill => ({
                                ...skill,
                                jobReqSkillName: skill.jobreqskills?.jobReqSkillName || 'Unknown Skill',
                                jobReqSkillType: skill.jobreqskills?.jobReqSkillType || 'General'
                            })) : [];
                        }
                    } catch (err) {
                        console.error('⚠️ Error fetching skills, continuing...', err);
                    }

                    // Fetch Objectives (with error handling)
                    let objectives = [];
                    try {
                        const { data: objectivesData, error: objectivesError } = await supabase
                            .from('training_records_objectives')
                            .select(`
                                trainingRecordObjectiveId,
                                created_at,
                                objectivesettings_objectives!objectiveId (
                                    objectiveName
                                )
                            `)
                            .eq('trainingRecordId', trainingRecordId);

                        if (!objectivesError) {
                            objectives = objectivesData ? objectivesData.map(obj => ({
                                ...obj,
                                objectiveName: obj.objectivesettings_objectives?.objectiveName || 'Objective'
                            })) : [];
                        }
                    } catch (err) {
                        console.error('⚠️ Error fetching objectives, continuing...', err);
                    }

                    // Fetch Categories (with error handling)
                    let categories = [];
                    try {
                        const { data: categoriesData, error: categoriesError } = await supabase
                            .from('training_records_categories')
                            .select(`
                                trainingRecordCategoriesId,
                                created_at,
                                training_categories!trainingCategoriesId (
                                    categoryName
                                )
                            `)
                            .eq('trainingRecordId', trainingRecordId);

                        if (!categoriesError) {
                            categories = categoriesData ? categoriesData.map(cat => ({
                                ...cat,
                                categoryName: cat.training_categories?.categoryName || 'Category'
                            })) : [];
                        }
                    } catch (err) {
                        console.error('⚠️ Error fetching categories, continuing...', err);
                    }

                    // Fetch Certificates (with error handling)
                    let certificates = [];
                    try {
                        const { data: certificatesData, error: certificatesError } = await supabase
                            .from('training_records_certificates')
                            .select(`
                                trainingRecordCertificateId,
                                created_at,
                                certificate_url,
                                trainingCertTitle,
                                trainingCertDesc
                            `)
                            .eq('trainingRecordId', trainingRecordId);

                        if (!certificatesError) {
                            certificates = certificatesData || [];
                        }
                    } catch (err) {
                        console.error('⚠️ Error fetching certificates, continuing...', err);
                    }

                    console.log(`   📊 Activities: ${activities.length}, Skills: ${skills.length}, Objectives: ${objectives.length}, Categories: ${categories.length}, Certificates: ${certificates.length}`);

                    comprehensiveTrainings.push({
                        ...training,
                        activities: activities,
                        skills: skills,
                        objectives: objectives,
                        categories: categories,
                        certificates: certificates
                    });
                    
                } catch (err) {
                    console.error(`⚠️ Error processing training ${training.trainingRecordId}, skipping...`, err);
                    // Add the training without detailed data
                    comprehensiveTrainings.push({
                        ...training,
                        activities: [],
                        skills: [],
                        objectives: [],
                        categories: [],
                        certificates: []
                    });
                }
            }
        }

        console.log('✅ Successfully fetched comprehensive training data');

        const response = {
            success: true,
            employee: {
                userId: employee.userId,
                firstName: employee.firstName,
                lastName: employee.lastName,
                email: employee.useraccounts?.userEmail,
                jobTitle: employee.jobpositions?.jobTitle,
                department: employee.jobpositions?.departments?.deptName
            },
            trainings: comprehensiveTrainings
        };

        res.json(response);

    } catch (error) {
        console.error('💥 ERROR in getEmployeeTrainingHistory:', error);
        
        // Make sure we always return JSON
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            success: false
        });
    }
},

endorseTrainingToHR: async function (req, res) {
    try {
        const { trainingRecordId } = req.body;
        const currentDate = new Date().toISOString();

        const { data, error } = await supabase
            .from('training_records')
            .update({
                status: 'For HR Approval',
                lmDecisionDate: currentDate,
                lmDecisionRemarks: 'Endorsed to HR for approval'
            })
            .eq('trainingRecordId', trainingRecordId)
            .select();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Training successfully endorsed to HR',
            data: data
        });
    } catch (error) {
        console.error('Error endorsing training:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
},

cancelTraining: async function (req, res) {
    try {
        const { trainingRecordId, remarks } = req.body;
        const currentDate = new Date().toISOString();

        const { data, error } = await supabase
            .from('training_records')
            .update({
                status: 'Cancelled',
                lmDecisionDate: currentDate,
                lmDecisionRemarks: remarks || 'Training cancelled by line manager'
            })
            .eq('trainingRecordId', trainingRecordId)
            .select();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Training successfully cancelled',
            data: data
        });
    } catch (error) {
        console.error('Error cancelling training:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
},
getTrainingDetailsAPI: async function (req, res) {
    try {
        const { id } = req.params;
        
        // First get the training record
        const { data: trainingRecord, error: recordError } = await supabase
            .from('training_records')
            .select(`
                *,
                useraccounts!userId (userEmail),
                jobpositions!jobId (jobTitle)
            `)
            .eq('trainingRecordId', id)
            .single();

        if (recordError) throw recordError;
        if (!trainingRecord) throw new Error('Training record not found');

        // Then get staff details separately
        const { data: staffData, error: staffError } = await supabase
            .from('staffaccounts')
            .select('firstName, lastName, position, department')
            .eq('userId', trainingRecord.userId)
            .single();

        // Combine the data
        const responseData = {
            ...trainingRecord,
            staffaccounts: staffError ? null : staffData
        };

        res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Error fetching training details:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
},

// Enhanced version of your existing getEmployeeTrainingProgress function
getEmployeeTrainingProgress: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const userId = req.session.user.userId;
        console.log(`[${new Date().toISOString()}] Fetching training progress for user ${userId}`);
        
        // FIXED: Fetch directly from training_records (no joins needed)
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select('*')
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

        // Process each training record to get activity progress
        const trainingProgressPromises = trainingRecords.map(async (record) => {
            try {
                console.log(`Processing training record ${record.trainingRecordId}: ${record.trainingName}`);

                // Get activity progress for this training record
                const { data: recordActivities, error: activitiesError } = await supabase
                    .from('training_records_activities')
                    .select('*')
                    .eq('trainingRecordId', record.trainingRecordId);

                if (activitiesError) {
                    console.error(`Error fetching activities for record ${record.trainingRecordId}:`, activitiesError);
                }

                // Calculate progress
                const totalActivities = recordActivities?.length || 0;
                const completedActivities = recordActivities?.filter(ra => ra.status === 'Completed')?.length || 0;
                const inProgressActivities = recordActivities?.filter(ra => ra.status === 'In Progress')?.length || 0;

                // Enhanced percentage calculation
                let progressPercentage = 0;
                if (totalActivities > 0) {
                    const partialProgress = (completedActivities * 1.0) + (inProgressActivities * 0.5);
                    progressPercentage = Math.round((partialProgress / totalActivities) * 100);
                }

                // Get certificates for this training record
                const { data: certificates, error: certError } = await supabase
                    .from('training_records_certificates')
                    .select('*')
                    .eq('trainingRecordId', record.trainingRecordId);

                if (certError) {
                    console.error(`Error fetching certificates for record ${record.trainingRecordId}:`, certError);
                }

                // Check if there are valid certificates
                const hasValidCertificates = certificates?.some(cert => 
                    cert.certificate_url && cert.certificate_url.trim() !== ''
                ) || false;

                // FIXED: Use the new status enum values
                let finalStatus = record.status || 'Not Started';
                
                // Map database status to display status
                if (record.status === 'For Line Manager Endorsement' || record.status === 'For HR Approval') {
                    finalStatus = 'Awaiting Approval';
                } else if (record.status === 'Cancelled') {
                    finalStatus = 'Rejected';
                } else if (record.isApproved === true) {
                    // For approved trainings, determine based on progress
                    if (hasValidCertificates) {
                        finalStatus = 'Completed';
                        progressPercentage = 100;
                    } else if (completedActivities > 0 || inProgressActivities > 0) {
                        finalStatus = 'In Progress';
                    } else {
                        finalStatus = 'Not Started';
                    }
                    
                    // Check for overdue
                    const today = new Date();
                    const endDate = record.setEndDate ? new Date(record.setEndDate) : null;
                    if (endDate && today > endDate && progressPercentage < 100) {
                        finalStatus = 'Overdue';
                    }
                }

                // Check if it's an ongoing required course
                const isOngoingRequired = record.isApproved === true && 
                                        (finalStatus === 'Not Started' || finalStatus === 'In Progress') &&
                                        record.setStartDate && record.setEndDate &&
                                        new Date() >= new Date(record.setStartDate) && 
                                        new Date() <= new Date(record.setEndDate);

                return {
                    trainingRecordId: record.trainingRecordId,
                    trainingName: record.trainingName,
                    trainingDesc: record.trainingDesc,
                    isOnlineArrangement: record.isOnlineArrangement,
                    totalDuration: record.totalDuration,
                    cost: record.cost,
                    address: record.address,
                    country: record.country,
                    setStartDate: record.setStartDate,
                    setEndDate: record.setEndDate,
                    dateRequested: record.dateRequested,
                    isApproved: record.isApproved,
                    trainingStatus: record.status, // Database status
                    status: finalStatus, // Display status
                    trainingPercentage: progressPercentage,
                    totalActivities,
                    completedActivities,
                    inProgressActivities,
                    isOngoingRequired,
                    activities: recordActivities || [],
                    certificates: certificates || [],
                    hasValidCertificates
                };

            } catch (error) {
                console.error(`Error processing training record ${record.trainingRecordId}:`, error);
                return {
                    trainingRecordId: record.trainingRecordId,
                    trainingName: record.trainingName || 'Unknown Training',
                    trainingPercentage: 0,
                    totalActivities: 0,
                    completedActivities: 0,
                    status: 'Error',
                    isOngoingRequired: false,
                    activities: [],
                    certificates: [],
                    error: error.message
                };
            }
        });

        const trainingsWithProgress = await Promise.all(trainingProgressPromises);

        console.log(`Successfully processed ${trainingsWithProgress.length} training records`);

        res.json({
            success: true,
            data: trainingsWithProgress
        });

    } catch (error) {
        console.error('Error in getEmployeeTrainingProgress:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch training progress',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

// Enhanced version of your existing getEmployeeAllCourses function 
getEmployeeAllCourses: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Employee') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Employee access only.' 
        });
    }

    try {
        const userId = req.session.user.userId;
        console.log(`[${new Date().toISOString()}] Fetching all courses for user ${userId}`);
        
        // FIXED: Fetch directly from training_records
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select('*')
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

        // Process each record to add progress information
        const coursesWithProgress = await Promise.all(
            trainingRecords.map(async (record) => {
                try {
                    // Get activity progress
                    const { data: activities, error: activitiesError } = await supabase
                        .from('training_records_activities')
                        .select('status')
                        .eq('trainingRecordId', record.trainingRecordId);

                    if (activitiesError) {
                        console.error(`Error fetching activities for record ${record.trainingRecordId}:`, activitiesError);
                    }

                    const totalActivities = activities?.length || 0;
                    const completedActivities = activities?.filter(a => a.status === 'Completed').length || 0;
                    const inProgressActivities = activities?.filter(a => a.status === 'In Progress').length || 0;
                    
                    // Calculate percentage
                    let trainingPercentage = 0;
                    if (totalActivities > 0) {
                        const partialProgress = (completedActivities * 1.0) + (inProgressActivities * 0.5);
                        trainingPercentage = Math.round((partialProgress / totalActivities) * 100);
                    }

                    // FIXED: Map database status to display status
                    let status = 'Not Started';
                    if (record.status === 'For Line Manager Endorsement' || record.status === 'For HR Approval') {
                        status = 'Awaiting Approval';
                    } else if (record.status === 'Cancelled') {
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
                        totalActivities,
                        completedActivities,
                        inProgressActivities,
                        trainingPercentage,
                        status
                    };
                } catch (error) {
                    console.error(`Error processing course record ${record.trainingRecordId}:`, error);
                    return {
                        ...record,
                        totalActivities: 0,
                        completedActivities: 0,
                        inProgressActivities: 0,
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
        console.error('Error in getEmployeeAllCourses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch courses',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},

// NEW FUNCTION: Add this to your line manager controller for calculating employee progress
getEmployeeProgressForLineManager: async function(userId) {
    try {
        // Get approved training records for this employee
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select('*')
            .eq('userId', userId)
            .eq('isApproved', true);

        if (recordsError) {
            console.error(`Error fetching training records for user ${userId}:`, recordsError);
            return { overallProgressPercentage: 0, progressDisplay: 'Error', totalTrainings: 0, completedTrainings: 0, activeTrainings: 0 };
        }

        let totalProgress = 0;
        let totalTrainings = trainingRecords?.length || 0;
        let completedTrainings = 0;
        let activeTrainings = 0;

        if (totalTrainings > 0) {
            const progressPromises = trainingRecords.map(async (record) => {
                try {
                    // Get activities
                    const { data: activities } = await supabase
                        .from('training_records_activities')
                        .select('status')
                        .eq('trainingRecordId', record.trainingRecordId);

                    const totalActivities = activities?.length || 0;
                    const completedActivities = activities?.filter(a => a.status === 'Completed').length || 0;
                    const inProgressActivities = activities?.filter(a => a.status === 'In Progress').length || 0;

                    let trainingProgress = 0;
                    if (totalActivities > 0) {
                        const partialProgress = (completedActivities * 1.0) + (inProgressActivities * 0.5);
                        trainingProgress = Math.round((partialProgress / totalActivities) * 100);
                    }

                    // Check for certificates (indicates completion)
                    const { data: certificates } = await supabase
                        .from('training_records_certificates')
                        .select('certificate_url')
                        .eq('trainingRecordId', record.trainingRecordId);

                    if (certificates?.some(cert => cert.certificate_url && cert.certificate_url.trim() !== '')) {
                        trainingProgress = 100;
                    }

                    // Count completed and active trainings
                    if (trainingProgress === 100) {
                        completedTrainings++;
                    } else if (trainingProgress > 0) {
                        activeTrainings++;
                    }

                    return trainingProgress;
                } catch (error) {
                    console.error(`Error processing training ${record.trainingRecordId}:`, error);
                    return 0;
                }
            });

            const progressResults = await Promise.all(progressPromises);
            totalProgress = progressResults.reduce((sum, progress) => sum + progress, 0);
        }

        const overallProgressPercentage = totalTrainings > 0 ? Math.round(totalProgress / totalTrainings) : 0;
        const progressDisplay = totalTrainings > 0 ? `${overallProgressPercentage}%` : 'No Training';

        // Determine training status
        let trainingStatus = 'No Training';
        let statusClass = 'status-no-training';

        if (totalTrainings > 0) {
            if (completedTrainings === totalTrainings) {
                trainingStatus = 'All Completed';
                statusClass = 'status-completed';
            } else if (activeTrainings > 0) {
                trainingStatus = `${activeTrainings} In Progress`;
                statusClass = 'status-in-progress';
            } else {
                trainingStatus = 'Not Started';
                statusClass = 'status-not-started';
            }
        }

        return {
            overallProgressPercentage,
            progressDisplay,
            totalTrainings,
            completedTrainings,
            activeTrainings,
            trainingStatus,
            statusClass
        };

    } catch (error) {
        console.error(`Error calculating progress for employee ${userId}:`, error);
        return { 
            overallProgressPercentage: 0, 
            progressDisplay: 'Error', 
            totalTrainings: 0, 
            completedTrainings: 0, 
            activeTrainings: 0,
            trainingStatus: 'Error',
            statusClass: 'status-error'
        };
    }
},

// Replace your getEmployeeProgressForLineManagerRoute function with this fixed version:

getEmployeeProgressForLineManagerRoute: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized. Line Manager access only.' 
        });
    }

    try {
        const userId = req.params.userId;
        console.log(`[${new Date().toISOString()}] Fetching progress for employee ${userId}`);

        // Get approved training records for this employee
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select('*')
            .eq('userId', userId)
            .eq('isApproved', true);

        if (recordsError) {
            console.error(`Error fetching training records for user ${userId}:`, recordsError);
            throw recordsError;
        }

        let totalProgress = 0;
        let totalTrainings = trainingRecords?.length || 0;
        let completedTrainings = 0;
        let activeTrainings = 0;

        if (totalTrainings > 0) {
            const progressPromises = trainingRecords.map(async (record) => {
                try {
                    // Get activities
                    const { data: activities } = await supabase
                        .from('training_records_activities')
                        .select('status')
                        .eq('trainingRecordId', record.trainingRecordId);

                    const totalActivities = activities?.length || 0;
                    const completedActivities = activities?.filter(a => a.status === 'Completed').length || 0;
                    const inProgressActivities = activities?.filter(a => a.status === 'In Progress').length || 0;

                    let trainingProgress = 0;
                    if (totalActivities > 0) {
                        const partialProgress = (completedActivities * 1.0) + (inProgressActivities * 0.5);
                        trainingProgress = Math.round((partialProgress / totalActivities) * 100);
                    }

                    // Check for certificates (indicates completion)
                    const { data: certificates } = await supabase
                        .from('training_records_certificates')
                        .select('certificate_url')
                        .eq('trainingRecordId', record.trainingRecordId);

                    if (certificates?.some(cert => cert.certificate_url && cert.certificate_url.trim() !== '')) {
                        trainingProgress = 100;
                    }

                    // Count completed and active trainings
                    if (trainingProgress === 100) {
                        completedTrainings++;
                    } else if (trainingProgress > 0) {
                        activeTrainings++;
                    }

                    return trainingProgress;
                } catch (error) {
                    console.error(`Error processing training ${record.trainingRecordId}:`, error);
                    return 0;
                }
            });

            const progressResults = await Promise.all(progressPromises);
            totalProgress = progressResults.reduce((sum, progress) => sum + progress, 0);
        }

        const overallProgressPercentage = totalTrainings > 0 ? Math.round(totalProgress / totalTrainings) : 0;
        const progressDisplay = totalTrainings > 0 ? `${overallProgressPercentage}%` : 'No Training';

        // Determine training status
        let trainingStatus = 'No Training';
        let statusClass = 'status-no-training';

        if (totalTrainings > 0) {
            if (completedTrainings === totalTrainings) {
                trainingStatus = 'All Completed';
                statusClass = 'status-completed';
            } else if (activeTrainings > 0) {
                trainingStatus = `${activeTrainings} In Progress`;
                statusClass = 'status-in-progress';
            } else {
                trainingStatus = 'Not Started';
                statusClass = 'status-not-started';
            }
        }

        const progressData = {
            overallProgressPercentage,
            progressDisplay,
            totalTrainings,
            completedTrainings,
            activeTrainings,
            trainingStatus,
            statusClass
        };

        console.log(`Successfully calculated progress for user ${userId}:`, progressData);

        res.json({
            success: true,
            data: progressData
        });

    } catch (error) {
        console.error('Error in getEmployeeProgressForLineManagerRoute:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch employee progress',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
// ============================
// PENDING TRAINING REQUESTS MANAGEMENT
// ============================
// Approve single training request by record ID
// approveTrainingRequestByRecord: async function (req, res) {
//     try {
//         console.log('🟢 Approving training request by record ID...');
//         const { recordId } = req.body;
        
//         if (!recordId) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Record ID is required'
//             });
//         }
        
//         // Get training record with training and job position details
//         const { data: trainingRecord, error: fetchError } = await supabase
//             .from('training_records')
//             .select(`
//                 trainingId,
//                 userId,
//                 trainings(cost, jobId, jobpositions(departmentId))
//             `)
//             .eq('trainingRecordId', recordId)
//             .single();
        
//         if (fetchError || !trainingRecord) {
//             console.error('Training record not found:', fetchError);
//             return res.status(404).json({
//                 success: false,
//                 message: 'Training request not found'
//             });
//         }

//         // Verify required data
//         if (!trainingRecord.trainings?.cost || !trainingRecord.trainings.jobpositions?.departmentId) {
//             console.error('Missing required data:', {
//                 cost: trainingRecord.trainings?.cost,
//                 departmentId: trainingRecord.trainings.jobpositions?.departmentId
//             });
//             return res.status(400).json({
//                 success: false,
//                 message: 'Missing required training cost or department information'
//             });
//         }

//         const trainingCost = trainingRecord.trainings.cost;
//         const departmentId = trainingRecord.trainings.jobpositions.departmentId;

//         // Get department budget
//         const { data: budgetData, error: budgetError } = await supabase
//             .from('training_budgets')
//             .select('amount, trainingBugetId')
//             .eq('departmentId', departmentId)
//             .single();

//         if (budgetError || !budgetData) {
//             console.error('Training budget not found:', budgetError);
//             return res.status(404).json({
//                 success: false,
//                 message: 'Training budget not found for department'
//             });
//         }

//         // Check budget
//         if (budgetData.amount < trainingCost) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Insufficient training budget for this request'
//             });
//         }
        
//         // Update record
//         const { data, error } = await supabase
//             .from('training_records')
//             .update({ 
//                 isApproved: true,
//                 trainingStatus: 'Not Started'
//             })
//             .eq('trainingRecordId', recordId)
//             .select();
        
//         if (error) {
//             console.error('Error approving request:', error);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to approve training request: ' + error.message
//             });
//         }

//         // Update budget
//         const newBudgetAmount = budgetData.amount - trainingCost;
//         const { error: budgetUpdateError } = await supabase
//             .from('training_budgets')
//             .update({ amount: newBudgetAmount })
//             .eq('trainingBugetId', budgetData.trainingBugetId);

//         if (budgetUpdateError) {
//             console.error('Budget update failed:', budgetUpdateError);
//             // Rollback
//             await supabase
//                 .from('training_records')
//                 .update({ 
//                     isApproved: false,
//                     trainingStatus: 'For Approval'
//                 })
//                 .eq('trainingRecordId', recordId);

//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to update budget: ' + budgetUpdateError.message
//             });
//         }
        
//         console.log('Request approved. Budget updated:', {
//             departmentId,
//             deducted: trainingCost,
//             remaining: newBudgetAmount
//         });
        
//         res.json({
//             success: true,
//             message: 'Training request approved successfully',
//             data: data[0],
//             budgetDeducted: trainingCost,
//             remainingBudget: newBudgetAmount
//         });
        
//     } catch (error) {
//         console.error('Error in approval:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Internal server error: ' + error.message
//         });
//     }
// },

// // Reject single training request by record ID
// rejectTrainingRequestByRecord: async function (req, res) {
//     try {
//         console.log('🔴 Rejecting training request by record ID...');
//         const { recordId, reason } = req.body;
        
//         if (!recordId) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Record ID is required'
//             });
//         }
        
//         console.log('Record ID to reject:', recordId);
//         console.log('Rejection reason:', reason);
        
//         // First, get the current record to check if it exists
//         const { data: existingRecord, error: fetchError } = await supabase
//             .from('training_records')
//             .select('*')
//             .eq('trainingRecordId', recordId)
//             .single();
        
//         if (fetchError || !existingRecord) {
//             console.error('Training record not found:', fetchError);
//             return res.status(404).json({
//                 success: false,
//                 message: 'Training request not found'
//             });
//         }
        
//         // Update the training record to set isApproved = false and trainingStatus = cancelled
//         const { data, error } = await supabase
//             .from('training_records')
//             .update({ 
//                 isApproved: false,
//                 trainingStatus: 'Cancelled' // Set to Cancelled when rejected
//             })
//             .eq('trainingRecordId', recordId)
//             .select();
        
//         if (error) {
//             console.error('Error rejecting training request:', error);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to reject training request: ' + error.message
//             });
//         }
        
//         console.log('Training request rejected successfully:', data[0]);
        
//         res.json({
//             success: true,
//             message: 'Training request rejected successfully',
//             data: data[0]
//         });
        
//     } catch (error) {
//         console.error('Error in rejectTrainingRequestByRecord:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Internal server error: ' + error.message
//         });
//     }
// },
// approveTrainingRequestsBulk: async function (req, res) {
//     try {
//         console.log('🟢 Bulk approving training requests...');
//         const { recordIds } = req.body;
        
//         if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Record IDs array is required'
//             });
//         }
        
//         // Get all training records with their training and job position details
//         const { data: trainingRecords, error: fetchError } = await supabase
//             .from('training_records')
//             .select(`
//                 trainingRecordId,
//                 trainingId,
//                 userId,
//                 trainings(cost, jobId, jobpositions(departmentId))
//             `)
//             .in('trainingRecordId', recordIds);
        
//         if (fetchError) {
//             console.error('Error fetching records:', fetchError);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to fetch training records: ' + fetchError.message
//             });
//         }
        
//         const validRecords = trainingRecords.filter(record => 
//             record.trainings?.cost && record.trainings.jobpositions?.departmentId
//         );

//         if (validRecords.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'No valid training requests found with complete information'
//             });
//         }

//         // Group by department and check budgets
//         const departmentCosts = {};
//         const insufficientBudgetRecords = [];
//         const recordsToApprove = [];

//         // First pass: organize by department and check budgets
//         for (const record of validRecords) {
//             const cost = record.trainings.cost;
//             const departmentId = record.trainings.jobpositions.departmentId;

//             if (!departmentCosts[departmentId]) {
//                 const { data: budgetData, error: budgetError } = await supabase
//                     .from('training_budgets')
//                     .select('amount, trainingBugetId')
//                     .eq('departmentId', departmentId)
//                     .single();

//                 if (budgetError || !budgetData) {
//                     console.error('Budget not found for department:', departmentId);
//                     continue;
//                 }

//                 departmentCosts[departmentId] = {
//                     currentAmount: budgetData.amount,
//                     trainingBugetId: budgetData.trainingBugetId,
//                     totalDeduction: 0,
//                     records: []
//                 };
//             }

//             if (departmentCosts[departmentId].currentAmount >= 
//                 departmentCosts[departmentId].totalDeduction + cost) {
//                 departmentCosts[departmentId].totalDeduction += cost;
//                 departmentCosts[departmentId].records.push(record.trainingRecordId);
//                 recordsToApprove.push(record.trainingRecordId);
//             } else {
//                 insufficientBudgetRecords.push(record.trainingRecordId);
//             }
//         }

//         if (recordsToApprove.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'No records could be approved due to insufficient budgets',
//                 insufficientBudgetRecords
//             });
//         }

//         // Bulk approve
//         const { data: approvedRecords, error: approvalError } = await supabase
//             .from('training_records')
//             .update({ 
//                 isApproved: true,
//                 trainingStatus: 'Not Started'
//             })
//             .in('trainingRecordId', recordsToApprove)
//             .select();

//         if (approvalError) {
//             console.error('Bulk approval failed:', approvalError);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to approve requests: ' + approvalError.message
//             });
//         }

//         // Update budgets
//         const budgetUpdates = Object.keys(departmentCosts).map(deptId => {
//             const dept = departmentCosts[deptId];
//             const newAmount = dept.currentAmount - dept.totalDeduction;
//             return supabase
//                 .from('training_budgets')
//                 .update({ amount: newAmount })
//                 .eq('trainingBugetId', dept.trainingBugetId);
//         });

//         const budgetResults = await Promise.all(budgetUpdates);
//         const budgetErrors = budgetResults.filter(r => r.error);

//         if (budgetErrors.length > 0) {
//             console.error('Some budget updates failed:', budgetErrors);
//             // In production, you might want to rollback approvals here
//         }

//         console.log(`Bulk approved ${approvedRecords?.length || 0} requests`);
        
//         res.json({
//             success: true,
//             message: `Approved ${approvedRecords?.length || 0} training requests`,
//             data: approvedRecords,
//             approvedCount: approvedRecords?.length || 0,
//             requestedCount: recordIds.length,
//             insufficientBudgetRecords,
//             budgetUpdates: Object.keys(departmentCosts).map(deptId => ({
//                 departmentId: deptId,
//                 amountDeducted: departmentCosts[deptId].totalDeduction,
//                 newAmount: departmentCosts[deptId].currentAmount - departmentCosts[deptId].totalDeduction
//             }))
//         });
        
//     } catch (error) {
//         console.error('Error in bulk approval:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Internal server error: ' + error.message
//         });
//     }
// },
// // Reject multiple training requests in bulk
// rejectTrainingRequestsBulk: async function (req, res) {
//     try {
//         console.log('🔴 Bulk rejecting training requests...');
//         const { recordIds, reason } = req.body;
        
//         if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Record IDs array is required'
//             });
//         }
        
//         console.log('Record IDs to reject:', recordIds);
//         console.log('Rejection reason:', reason);
        
//         // First, check which records exist
//         const { data: existingRecords, error: fetchError } = await supabase
//             .from('training_records')
//             .select('trainingRecordId')
//             .in('trainingRecordId', recordIds);
        
//         if (fetchError) {
//             console.error('Error fetching training records:', fetchError);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to fetch training records: ' + fetchError.message
//             });
//         }
        
//         const existingRecordIds = existingRecords.map(record => record.trainingRecordId);
//         console.log('Found existing records:', existingRecordIds.length, 'out of', recordIds.length);
        
//         if (existingRecordIds.length === 0) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'No training requests found'
//             });
//         }
        
//         // Update multiple training records to set isApproved = false
//         const { data, error } = await supabase
//             .from('training_records')
//             .update({ 
//                 isApproved: false,
//                 trainingStatus: 'Cancelled' // Set to Cancelled when rejected
//             })
//             .in('trainingRecordId', existingRecordIds)
//             .select();
        
//         if (error) {
//             console.error('Error bulk rejecting training requests:', error);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to reject training requests: ' + error.message
//             });
//         }
        
//         console.log(`Bulk rejected ${data?.length || 0} training requests`);
        
//         res.json({
//             success: true,
//             message: `Successfully rejected ${data?.length || 0} training requests`,
//             data: data,
//             rejectedCount: data?.length || 0,
//             requestedCount: recordIds.length,
//             foundCount: existingRecordIds.length
//         });
        
//     } catch (error) {
//         console.error('Error in rejectTrainingRequestsBulk:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Internal server error: ' + error.message
//         });
//     }
// },

// getTrainingObjectives: async function(req, res) {
//     try {
//         const trainingId = req.params.trainingId;
        
//         // Get objectives for this training
//         const { data: trainingObjectives, error } = await supabase
//             .from('training_objectives')
//             .select(`
//                 objectiveId,
//                 objectivesettings_objectives(objectiveDescrpt)
//             `)
//             .eq('trainingId', trainingId);

//         if (error) {
//             console.error('Error fetching training objectives:', error);
//             return res.json({ success: false, message: 'Error fetching objectives' });
//         }

//         // Format the objectives
//         const objectives = (trainingObjectives || []).map(item => ({
//             id: item.objectiveId,
//             description: item.objectivesettings_objectives?.objectiveDescrpt || 'No description'
//         }));

//         res.json({ 
//             success: true, 
//             objectives: objectives 
//         });

//     } catch (error) {
//         console.error('Error in getTrainingObjectives:', error);
//         res.json({ success: false, message: 'Server error' });
//     }
// },

// getTrainingSkills: async function(req, res) {
//     try {
//         const trainingId = req.params.trainingId;
        
//         // Get skills for this training
//         const { data: trainingSkills, error } = await supabase
//             .from('training_skills')
//             .select(`
//                 jobReqSkillId,
//                 jobreqskills(jobReqSkillName, jobReqSkillType)
//             `)
//             .eq('trainingId', trainingId);

//         if (error) {
//             console.error('Error fetching training skills:', error);
//             return res.json({ success: false, message: 'Error fetching skills' });
//         }

//         // Format the skills
//         const skills = (trainingSkills || []).map(item => ({
//             id: item.jobReqSkillId,
//             name: item.jobreqskills?.jobReqSkillName || 'Unknown Skill',
//             type: item.jobreqskills?.jobReqSkillType || 'Unknown Type'
//         }));

//         res.json({ 
//             success: true, 
//             skills: skills 
//         });

//     } catch (error) {
//         console.error('Error in getTrainingSkills:', error);
//         res.json({ success: false, message: 'Server error' });
//     }
// },

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
getInterviewForm: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        try {
            // Extract the applicantId from the URL parameters 
            const applicantId = req.params.applicantId;
            
            // Log for debugging
            console.log('Fetching interview form for applicantId:', applicantId);
            
            // Check if applicantId is valid
            if (!applicantId || applicantId === ':applicantId') {
                console.error('Invalid applicantId provided:', applicantId);
                req.flash('errors', { message: 'Invalid Applicant ID.' });
                return res.redirect('/linemanager/applicant-tracker');
            }
            
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
                return res.redirect('/linemanager/applicant-tracker');
            }
            
            if (!applicant) {
                console.error('No applicant found with ID:', applicantId);
                req.flash('errors', { message: 'Applicant not found.' });
                return res.redirect('/linemanager/applicant-tracker');
            }
            
            // Verify this applicant is eligible for P3 evaluation
            if (!applicant.applicantStatus || !applicant.applicantStatus.includes('P3 - Awaiting for Line Manager Evaluation')) {
                console.error('Applicant not eligible for P3 evaluation. Current status:', applicant.applicantStatus);
                req.flash('errors', { message: 'This applicant is not awaiting line manager evaluation.' });
                return res.redirect('/linemanager/applicant-tracker');
            }
            
            console.log('Successfully fetched applicant for P3 evaluation:', applicant);
            
            // Fetch user email
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
            
            console.log('Rendering P3 interview form with data:', { 
                applicantId: applicant.applicantId,
                name: `${applicant.firstName} ${applicant.lastName}`,
                email: applicant.email,
                status: applicant.applicantStatus
            });
        
            // Render the interview form with the applicant data
            return res.render('staffpages/linemanager_pages/interview-form-linemanager', {
                applicant: applicant,
                user: req.session.user
            });
            
        } catch (error) {
            console.error('Error in getInterviewForm:', error);
            req.flash('errors', { message: 'An error occurred while processing your request.' });
            return res.redirect('/linemanager/applicant-tracker');
        }
    } 

    req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
    return res.redirect('/staff/login');
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
                
                const departmentName = employeeData[0]?.departments?.deptName || 'Department';
                const stats = null;
                const availableYears = [];
                const availableQuarters = [];
                const currentYear = new Date().getFullYear();

                res.render('staffpages/linemanager_pages/managerrecordsperftracker', { 
                    errors, 
                    employees: employeeList,
                    departmentName: departmentName,
                    stats: stats,
                    availableYears: availableYears,
                    availableQuarters: availableQuarters,
                    currentYear: currentYear
                });
    
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

        // Get jobId for the user
        const jobId = userData.staffaccounts[0]?.jobId;
        console.log('User jobId:', jobId);

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

        // NEW: Fetch user's objectives from the most recent objective settings
        let userObjectives = [];
        let userSkills = [];
        let availableTrainings = [];

        if (jobId) {
            // Get the most recent objective settings for this user
            const { data: objectiveSettings, error: objectiveError } = await supabase
                .from('objectivesettings')
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
                .eq('userId', userId)
                .eq('jobId', jobId)
                .order('performancePeriodYear', { ascending: false })
                .limit(1);

            if (objectiveError) {
                console.error('Error fetching objectives:', objectiveError);
            } else if (objectiveSettings && objectiveSettings.length > 0) {
                userObjectives = objectiveSettings[0].objectivesettings_objectives || [];
                console.log('Fetched user objectives:', userObjectives);
            }

            // Get job required skills for this position
            const { data: jobSkills, error: skillsError } = await supabase
                .from('jobreqskills')
                .select(`
                    jobReqSkillId,
                    jobReqSkillType,
                    jobReqSkillName
                `)
                .eq('jobId', jobId);

            if (skillsError) {
                console.error('Error fetching job skills:', skillsError);
            } else {
                userSkills = jobSkills || [];
                console.log('Fetched user job skills:', userSkills);
            }

const { data: trainingObjectives, error: trainingObjError } = await supabase
                .from('training_objectives')
                .select(`
                    trainingId,
                    objectiveId,
                    trainings (
                        trainingId,
                        trainingName,
                        trainingDesc
                    ),
                    objectivesettings_objectives!inner (
                        objectiveId,
                        objectiveDescrpt,
                        objectiveKPI
                    )
                `)
                .in('objectiveId', userObjectives.map(obj => obj.objectiveId));

            // Get trainings that have skills matching user's job skills
            const { data: trainingSkills, error: trainingSkillsError } = await supabase
                .from('training_skills')
                .select(`
                    trainingId,
                    jobReqSkillId,
                    trainings (
                        trainingId,
                        trainingName,
                        trainingDesc
                    ),
                    jobreqskills!inner (
                        jobReqSkillId,
                        jobReqSkillName,
                        jobReqSkillType
                    )
                `)
                .in('jobReqSkillId', userSkills.map(skill => skill.jobReqSkillId));

            if (trainingObjError) {
                console.error('Error fetching training objectives:', trainingObjError);
            }

            if (trainingSkillsError) {
                console.error('Error fetching training skills:', trainingSkillsError);
            }

            // Combine and process trainings with detailed objective and skill information
            const trainingMap = new Map();

            // Process trainings from objectives
            if (trainingObjectives) {
                trainingObjectives.forEach(item => {
                    if (item.trainings) {
                        const trainingId = item.trainings.trainingId;
                        
                        if (!trainingMap.has(trainingId)) {
                            trainingMap.set(trainingId, {
                                trainingId: trainingId,
                                trainingName: item.trainings.trainingName,
                                trainingDescription: item.trainings.trainingDesc,
                                matchType: 'objective',
                                objectives: [],
                                skills: []
                            });
                        }
                        
                        const training = trainingMap.get(trainingId);
                        
                        // Add objective details
                        if (item.objectivesettings_objectives) {
                            training.objectives.push({
                                objectiveId: item.objectivesettings_objectives.objectiveId,
                                objectiveDescrpt: item.objectivesettings_objectives.objectiveDescrpt,
                                objectiveKPI: item.objectivesettings_objectives.objectiveKPI
                            });
                        }
                    }
                });
            }

            // Process trainings from skills
            if (trainingSkills) {
                trainingSkills.forEach(item => {
                    if (item.trainings) {
                        const trainingId = item.trainings.trainingId;
                        
                        if (!trainingMap.has(trainingId)) {
                            trainingMap.set(trainingId, {
                                trainingId: trainingId,
                                trainingName: item.trainings.trainingName,
                                trainingDescription: item.trainings.trainingDesc,
                                matchType: 'skill',
                                objectives: [],
                                skills: []
                            });
                        } else {
                            // Mark as both if already exists from objectives
                            const training = trainingMap.get(trainingId);
                            training.matchType = 'both';
                        }
                        
                        const training = trainingMap.get(trainingId);
                        
                        // Add skill details
                        if (item.jobreqskills) {
                            training.skills.push({
                                jobReqSkillId: item.jobreqskills.jobReqSkillId,
                                jobReqSkillName: item.jobreqskills.jobReqSkillName,
                                jobReqSkillType: item.jobreqskills.jobReqSkillType
                            });
                        }
                    }
                });
            }

            // Convert Map to Array, remove duplicates, and sort by name
            availableTrainings = Array.from(trainingMap.values())
                .map(training => {
                    // Remove duplicate objectives and skills
                    training.objectives = training.objectives.filter((obj, index, self) => 
                        index === self.findIndex(o => o.objectiveId === obj.objectiveId)
                    );
                    
                    training.skills = training.skills.filter((skill, index, self) => 
                        index === self.findIndex(s => s.jobReqSkillId === skill.jobReqSkillId)
                    );
                    
                    return training;
                })
                .sort((a, b) => a.trainingName.localeCompare(b.trainingName));

            console.log('Enhanced available trainings with objectives and skills:', availableTrainings);
        }
    
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
            departmentId: userData.staffaccounts[0]?.departmentId || '',
            jobId: jobId || '',
            milestones: userData.staffaccounts[0]?.staffcareerprogression || [],
            degrees: userData.staffaccounts[0]?.staffdegrees || [],
            experiences: userData.staffaccounts[0]?.staffexperiences || [],
            certifications: userData.staffaccounts[0]?.staffcertification || [],
            weeklyAttendanceLogs: formattedAttendanceLogs,
            // UPDATED: Add filtered trainings and related data
            availableTrainings: availableTrainings,
            userObjectives: userObjectives,
            userSkills: userSkills
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
            }

            feedbackData[table] = data || [];
        }

        console.log("Feedback Data:", feedbackData);

        // Fetch objectives settings
        const { data: objectiveSettings, error: objectivesError } = await supabase
            .from('objectivesettings')
            .select('*')
            .eq('userId', user.userId)
            .eq('performancePeriodYear', selectedYear);

        if (objectivesError) {
            console.error('Error fetching objectives settings:', objectivesError);
        }

        let submittedObjectives = [];
        let objectiveQuestions = [];

        if (objectiveSettings && objectiveSettings.length > 0) {
            const objectiveSettingsIds = objectiveSettings.map(setting => setting.objectiveSettingsId);

            // Fetch the actual objectives related to the settings
            const { data: objectivesData, error: objectivesFetchError } = await supabase
                .from('objectivesettings_objectives')
                .select('*')
                .in('objectiveSettingsId', objectiveSettingsIds);

            if (!objectivesFetchError && objectivesData) {
                submittedObjectives = objectivesData;
            }

            // Fetch questions related to the objectives
            const { data: objectiveQuestionData, error: questionError } = await supabase
                .from('feedbacks_questions-objectives')
                .select('objectiveId, objectiveQualiQuestion')
                .in('objectiveId', submittedObjectives.map(obj => obj.objectiveId));

            if (!questionError && objectiveQuestionData) {
                objectiveQuestions = objectiveQuestionData;
            }
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
        }

        // Classify skills into Hard and Soft
        const hardSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Hard') || [];
        const softSkills = skillsData?.filter(skill => skill.jobReqSkillType === 'Soft') || [];

        // FIXED: Check if Mid-Year IDP data exists (without year filtering for current schema)
        const { data: midYearData, error: midYearError } = await supabase
            .from('midyearidps')
            .select('*')
            .eq('userId', user.userId)
            .maybeSingle();

        if (midYearError) {
            console.error('Error fetching mid-year IDP data:', midYearError);
        }

        // FIXED: Check if Final-Year IDP data exists (without year filtering for current schema)
        const { data: finalYearData, error: finalYearError } = await supabase
            .from('finalyearidps')
            .select('*')
            .eq('userId', user.userId)
            .maybeSingle();

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
                objectivesettings: objectiveSettings && objectiveSettings.length > 0,
                
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

        console.log("View State:", viewState);

        res.render('staffpages/linemanager_pages/managerrecordsperftracker-user', { 
            viewState: viewState, 
            user
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
getTrainingCategories: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        // Get user's department ID
        const { data: userData, error: userError } = await supabase
            .from("staffaccounts")
            .select("departmentId")
            .eq("userId", userId)
            .single();

        if (userError) {
            console.error("Error fetching user data:", userError);
            return res.status(500).json({ success: false, message: "Error fetching user data" });
        }

        if (!userData || !userData.departmentId) {
            return res.status(404).json({ success: false, message: "User department not found" });
        }

        // Get training categories for the user's department
        const { data: categories, error: categoriesError } = await supabase
            .from("training_categories")
            .select("*")
            .eq("departmentId", userData.departmentId)
            .order("category", { ascending: true });

        if (categoriesError) {
            console.error("Error fetching training categories:", categoriesError);
            return res.status(500).json({ success: false, message: "Error fetching training categories" });
        }

        return res.status(200).json({ 
            success: true, 
            categories: categories || [],
            departmentId: userData.departmentId
        });

    } catch (error) {
        console.error("Error in getTrainingCategories:", error);
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while fetching training categories",
            error: error.message 
        });
    }
},

// Function to add a new training category
addTrainingCategory: async function(req, res) {
    try {
        const { category, departmentId } = req.body;
        
        if (!category || !departmentId) {
            return res.status(400).json({ 
                success: false, 
                message: "Category name and department ID are required" 
            });
        }

        // Check if category already exists for this department
        const { data: existing, error: checkError } = await supabase
            .from("training_categories")
            .select("trainingCategoriesId")
            .eq("category", category.trim())
            .eq("departmentId", departmentId)
            .single();

        if (existing) {
            return res.status(409).json({ 
                success: false, 
                message: "Category already exists for this department" 
            });
        }

        // Insert new category
        const { data: newCategory, error: insertError } = await supabase
            .from("training_categories")
            .insert({
                category: category.trim(),
                departmentId: departmentId
            })
            .select()
            .single();

        if (insertError) {
            console.error("Error inserting training category:", insertError);
            return res.status(500).json({ 
                success: false, 
                message: "Error adding training category" 
            });
        }

        return res.status(201).json({ 
            success: true, 
            category: newCategory,
            message: "Training category added successfully" 
        });

    } catch (error) {
        console.error("Error in addTrainingCategory:", error);
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while adding the training category",
            error: error.message 
        });
    }
},

// FIXED: saveMidYearIDP function to properly handle training categories
saveMidYearIDP: async function(req, res) {
    try {
        const userId = req.params.userId || req.body.userId;
        console.log("Starting saveMidYearIDP for userId:", userId);
        console.log("Request body:", req.body);

        if (!userId) {
            console.error("User ID is missing");
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        // Get all form fields from the request body
        let {
            profStrengths,
            profAreasForDevelopment,
            profActionsToTake,
            leaderStrengths,
            leaderAreasForDevelopment,
            leaderActionsToTake,
            nextRoleShortTerm,
            nextRoleLongTerm,
            nextRoleMobility,
            trainingCategories,
            trainingRemarks,
            year
        } = req.body;

        // FIXED: Handle training categories - ensure it's properly formatted as an array of strings
        let processedTrainingCategories = [];
        
        console.log("Raw trainingCategories received:", trainingCategories, typeof trainingCategories);
        
        if (trainingCategories) {
            if (Array.isArray(trainingCategories)) {
                // If it's already an array, process each item
                processedTrainingCategories = trainingCategories
                    .map(cat => {
                        if (typeof cat === 'string') {
                            return cat.trim();
                        } else if (typeof cat === 'object' && cat !== null) {
                            // Handle objects with name/category properties
                            return (cat.name || cat.category || '').trim();
                        }
                        return '';
                    })
                    .filter(cat => cat.length > 0); // Remove empty strings
            } else if (typeof trainingCategories === 'string') {
                // If it's a string, try to parse as JSON or treat as single item
                try {
                    const parsed = JSON.parse(trainingCategories);
                    if (Array.isArray(parsed)) {
                        processedTrainingCategories = parsed
                            .map(cat => typeof cat === 'string' ? cat.trim() : '')
                            .filter(cat => cat.length > 0);
                    } else {
                        processedTrainingCategories = [trainingCategories.trim()];
                    }
                } catch (e) {
                    // Not JSON, treat as single category
                    if (trainingCategories.trim() !== '') {
                        processedTrainingCategories = [trainingCategories.trim()];
                    }
                }
            }
        }

        console.log("Processed trainingCategories:", processedTrainingCategories);

        // Clean text fields
        profStrengths = (profStrengths || '').toString().trim();
        profAreasForDevelopment = (profAreasForDevelopment || '').toString().trim();
        profActionsToTake = (profActionsToTake || '').toString().trim();
        leaderStrengths = (leaderStrengths || '').toString().trim();
        leaderAreasForDevelopment = (leaderAreasForDevelopment || '').toString().trim();
        leaderActionsToTake = (leaderActionsToTake || '').toString().trim();
        nextRoleShortTerm = (nextRoleShortTerm || '').toString().trim();
        nextRoleLongTerm = (nextRoleLongTerm || '').toString().trim();
        nextRoleMobility = (nextRoleMobility || '').toString().trim();
        trainingRemarks = (trainingRemarks || '').toString().trim();

        const currentYear = year || new Date().getFullYear();

        console.log("Final processed data:", {
            userId,
            profStrengths,
            profAreasForDevelopment,
            profActionsToTake,
            leaderStrengths,
            leaderAreasForDevelopment,
            leaderActionsToTake,
            nextRoleShortTerm,
            nextRoleLongTerm,
            nextRoleMobility,
            trainingCategories: processedTrainingCategories,
            trainingRemarks,
            year: currentYear
        });

        // Check if there's already an entry for this user
        const { data: existingRecord, error: checkError } = await supabase
            .from("midyearidps")
            .select("midyearidpId")
            .eq("userId", userId)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error("Error checking for existing midyearidp:", checkError);
            return res.status(500).json({ success: false, message: "Error checking for existing record" });
        }

        const dataToSave = {
            profStrengths,
            profAreasForDevelopment,
            profActionsToTake,
            leaderStrengths,
            leaderAreasForDevelopment,
            leaderActionsToTake,
            nextRoleShortTerm,
            nextRoleLongTerm,
            nextRoleMobility,
            trainingCategories: JSON.stringify(processedTrainingCategories), // FIXED: Ensure JSONB format
            trainingRemarks: trainingRemarks || null,
            year: currentYear
        };

        console.log("Data to save to database:", dataToSave);

        let result;

        if (existingRecord) {
            // Update existing record
            console.log("Updating existing midyearidp record:", existingRecord.midyearidpId);
            const { data, error } = await supabase
                .from("midyearidps")
                .update(dataToSave)
                .eq("midyearidpId", existingRecord.midyearidpId)
                .select();

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
                    ...dataToSave
                })
                .select();

            if (error) {
                console.error("Error inserting midyearidp:", error);
                return res.status(500).json({ success: false, message: error.message });
            }
            
            result = data;
        }

        console.log("Mid-Year IDP saved successfully with categories:", processedTrainingCategories);

        // If it's an API request (AJAX), return JSON
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(200).json({ 
                success: true, 
                message: "Mid-Year IDP saved successfully",
                data: result,
                savedCategories: processedTrainingCategories
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
getMidYearIDPWithTrainings: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        console.log('Fetching Mid-Year IDP with training categories for userId:', userId);

        // Get Mid-Year IDP data including trainingCategories JSONB field
        const { data: midyearData, error: midyearError } = await supabase
            .from("midyearidps")
            .select("*")
            .eq("userId", userId)
            .single();

        if (midyearError && midyearError.code !== 'PGRST116') {
            console.error("Error fetching Mid-Year IDP:", midyearError);
            return res.status(500).json({ success: false, message: "Error fetching Mid-Year IDP data" });
        }

        let responseData = {
            midYearData: midyearData,
            trainingCategories: [],
            trainingRemarks: null,
            suggestedTrainings: [] // Keep for backward compatibility
        };

        if (midyearData) {
            // FIXED: Extract training categories from JSONB field
            if (midyearData.trainingCategories && Array.isArray(midyearData.trainingCategories)) {
                console.log('Found training categories in JSONB:', midyearData.trainingCategories);
                responseData.trainingCategories = midyearData.trainingCategories;
            }

            // Extract training remarks
            if (midyearData.trainingRemarks) {
                responseData.trainingRemarks = midyearData.trainingRemarks;
            }

            // LEGACY: Also check for old suggested trainings format (if still needed)
            const { data: trainingsData, error: trainingsError } = await supabase
                .from("midyearidps_suggestedtrainings")
                .select(`
                    *,
                    trainings (
                        trainingId,
                        trainingName,
                        trainingDesc
                    )
                `)
                .eq("midyearidpId", midyearData.midyearidpId);

            if (!trainingsError && trainingsData) {
                responseData.suggestedTrainings = trainingsData;
            }
        }

        console.log('Returning training data:', {
            categoriesCount: responseData.trainingCategories.length,
            hasRemarks: !!responseData.trainingRemarks,
            legacyTrainingsCount: responseData.suggestedTrainings.length
        });

        return res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error("Error in getMidYearIDPWithTrainings:", error);
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while fetching Mid-Year IDP data",
            error: error.message 
        });
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

        // Then, get the Mid-Year IDP data INCLUDING training categories
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

        // ENHANCED: Include training categories in the midYearData
        if (midYearData) {
            console.log('Mid-Year IDP data found with training categories:', {
                hasTrainingCategories: !!midYearData.trainingCategories,
                categoriesCount: midYearData.trainingCategories ? midYearData.trainingCategories.length : 0,
                hasTrainingRemarks: !!midYearData.trainingRemarks
            });
        }

        // Determine view state - whether to show form or view-only mode
        const viewState = {
            viewOnlyStatus: {
                midyearidp: !!midYearData // true if midYearData exists, false otherwise
            },
            midYearData // Pass the complete data including training categories for view-only mode
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

    getMidYearIDPWithTrainings: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        // Get Mid-Year IDP data
        const { data: midyearData, error: midyearError } = await supabase
            .from("midyearidps")
            .select("*")
            .eq("userId", userId)
            .single();

        if (midyearError && midyearError.code !== 'PGRST116') {
            console.error("Error fetching Mid-Year IDP:", midyearError);
            return res.status(500).json({ success: false, message: "Error fetching Mid-Year IDP data" });
        }

        let suggestedTrainings = [];
        
        if (midyearData) {
            // Get suggested trainings with training details
            const { data: trainingsData, error: trainingsError } = await supabase
                .from("midyearidps_suggestedtrainings")
                .select(`
                    *,
                    trainings (
                        trainingId,
                        trainingName,
                        trainingDesc
                    )
                `)
                .eq("midyearidpId", midyearData.midyearidpId);

            if (!trainingsError && trainingsData) {
                suggestedTrainings = trainingsData;
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                midyearIDP: midyearData,
                suggestedTrainings: suggestedTrainings
            }
        });

    } catch (error) {
        console.error("Error in getMidYearIDPWithTrainings:", error);
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while fetching Mid-Year IDP data",
            error: error.message 
        });
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

getFinalYearIDPWithTrainings: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        console.log('Fetching Final-Year IDP with training categories for userId:', userId);

        // Get Final-Year IDP data including trainingCategories JSONB field
        const { data: finalyearData, error: finalyearError } = await supabase
            .from("finalyearidps") // Assuming you have this table
            .select("*")
            .eq("userId", userId)
            .single();

        if (finalyearError && finalyearError.code !== 'PGRST116') {
            console.error("Error fetching Final-Year IDP:", finalyearError);
            return res.status(500).json({ success: false, message: "Error fetching Final-Year IDP data" });
        }

        let responseData = {
            finalYearData: finalyearData,
            trainingCategories: [],
            trainingRemarks: null
        };

        if (finalyearData) {
            // Extract training categories from JSONB field
            if (finalyearData.trainingCategories && Array.isArray(finalyearData.trainingCategories)) {
                console.log('Found Final-Year training categories in JSONB:', finalyearData.trainingCategories);
                responseData.trainingCategories = finalyearData.trainingCategories;
            }

            // Extract training remarks
            if (finalyearData.trainingRemarks) {
                responseData.trainingRemarks = finalyearData.trainingRemarks;
            }
        }

        console.log('Returning Final-Year training data:', {
            categoriesCount: responseData.trainingCategories.length,
            hasRemarks: !!responseData.trainingRemarks
        });

        return res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error("Error in getFinalYearIDPWithTrainings:", error);
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while fetching Final-Year IDP data",
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
getFeedbackData: async function(req, res) {
    try {
        const userId = req.params.userId;
        const quarter = req.query.quarter; // e.g., "Q1", "Q2", etc.
        const currentUserId = req.session?.user?.userId;
        
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
        
        // 2. Get the target user's department and job info using staffaccounts
        const { data: targetUserData, error: targetUserError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                jobId,
                firstName,
                lastName,
                departments!inner (deptName),
                jobpositions!inner (jobTitle)
            `)
            .eq('userId', userId)
            .single();
            
        if (targetUserError || !targetUserData) {
            console.error('Error fetching target user data:', targetUserError);
            return res.status(404).json({
                success: false,
                message: "Unable to retrieve user information."
            });
        }
        
        const departmentId = targetUserData.departmentId;
        const jobId = targetUserData.jobId;
        
        // 3. Get the feedback record for this user and quarter
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
            
        if (feedbackError || !feedbackData) {
            console.error('Error fetching feedback data:', feedbackError);
            return res.status(404).json({
                success: false,
                message: `No ${quarter} feedback found for this user.`
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        
        console.log(`Using feedbackId: ${feedbackId} for further queries`);
        
        if (!feedbackId) {
            console.error(`Feedback ID not found`);
            return res.status(404).json({
                success: false,
                message: `Could not find feedback ID for this employee in ${quarter}`
            });
        }
        
        // 4. Get all staff in the same department for completion rate calculation
        const { data: departmentStaff, error: deptStaffError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                jobId,
                jobpositions!inner (jobTitle)
            `)
            .eq('departmentId', departmentId)
            .not('jobId', 'is', null);
            
        if (deptStaffError) {
            console.error('Error fetching department staff:', deptStaffError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving department staff data."
            });
        }
        
        // 5. Count UNIQUE reviewers for this specific feedback only
        const { data: feedbackAnswers, error: feedbackAnswersError } = await supabase
            .from('feedbacks_answers')
            .select(`
                feedbackId_answerId,
                reviewerUserId,
                userId,
                reviewDate,
                ${feedbackIdField}
            `)
            .eq(feedbackIdField, feedbackId)
            .not('reviewerUserId', 'is', null);
            
        if (feedbackAnswersError) {
            console.error('Error fetching feedback answers:', feedbackAnswersError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving feedback answers."
            });
        }
        
        // Get unique reviewers for THIS specific feedback only
        const uniqueReviewers = new Set();
        const answerIds = [];
        
        (feedbackAnswers || []).forEach(answer => {
            if (answer.reviewerUserId) {
                uniqueReviewers.add(answer.reviewerUserId);
                answerIds.push(answer.feedbackId_answerId);
            }
        });
        
        const totalResponses = uniqueReviewers.size;
        
        // 6. Calculate department-wide completion rate
        const departmentUserIds = departmentStaff.map(staff => staff.userId);
        
        const { data: allDepartmentFeedbacks, error: allFeedbackError } = await supabase
            .from(feedbackTable)
            .select(`userId, ${feedbackIdField}`)
            .in('userId', departmentUserIds)
            .eq('quarter', quarter);
            
        if (allFeedbackError) {
            console.error('Error fetching department feedbacks:', allFeedbackError);
        }
        
        // Count users who have received at least one feedback response
        let departmentResponseCount = 0;
        
        if (allDepartmentFeedbacks) {
            for (const deptFeedback of allDepartmentFeedbacks) {
                const { data: deptAnswers, error: deptAnswersError } = await supabase
                    .from('feedbacks_answers')
                    .select('reviewerUserId')
                    .eq(feedbackIdField, deptFeedback[feedbackIdField])
                    .not('reviewerUserId', 'is', null)
                    .limit(1);
                    
                if (!deptAnswersError && deptAnswers && deptAnswers.length > 0) {
                    departmentResponseCount++;
                }
            }
        }
        
        const totalStaffInDept = departmentStaff.length;
        const completionRate = totalStaffInDept > 0 ? Math.round((departmentResponseCount / totalStaffInDept) * 100) : 0;
        
        // 7. Calculate average rating from objectives and skills
        let totalRatings = 0;
        let validRatingCount = 0;
        
        if (answerIds.length > 0) {
            // Get objective ratings
            const { data: objectiveRatings, error: objRatingsError } = await supabase
                .from('feedbacks_answers-objectives')
                .select('objectiveQuantInput')
                .in('feedback_answerObjectivesId', answerIds)
                .not('objectiveQuantInput', 'is', null);
                
            if (!objRatingsError && objectiveRatings) {
                objectiveRatings.forEach(rating => {
                    if (rating.objectiveQuantInput && rating.objectiveQuantInput > 0) {
                        totalRatings += rating.objectiveQuantInput;
                        validRatingCount++;
                    }
                });
            }
            
            // Get skill ratings
            const { data: skillRatings, error: skillRatingsError } = await supabase
                .from('feedbacks_answers-skills')
                .select('skillsQuantInput')
                .in('feedback_answerSkillsId', answerIds)
                .not('skillsQuantInput', 'is', null);
                
            if (!skillRatingsError && skillRatings) {
                skillRatings.forEach(rating => {
                    if (rating.skillsQuantInput && rating.skillsQuantInput > 0) {
                        totalRatings += rating.skillsQuantInput;
                        validRatingCount++;
                    }
                });
            }
        }
        
        const averageRating = validRatingCount > 0 ? (totalRatings / validRatingCount) : 0;
        
        // 8. Get the objective settings for this user
        const { data: objectiveSettings, error: objectivesSettingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId, performancePeriodYear')
            .eq('userId', userId)
            .eq('jobId', jobId)
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (objectivesSettingsError || !objectiveSettings || objectiveSettings.length === 0) {
            console.error('Error fetching objective settings:', objectivesSettingsError);
            return res.status(404).json({
                success: false,
                message: "No objectives found for this user."
            });
        }
        
        const objectiveSettingsId = objectiveSettings[0].objectiveSettingsId;
        
        // 9. Get the actual objectives
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
        
        // 10. Get the feedback questions for objectives
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
        }
        
        // 11. Build objective feedback
        const objectiveFeedback = [];
        
        for (const objective of objectives || []) {
            const mapping = (objectiveQuestionsMapping || []).find(q => q.objectiveId === objective.objectiveId);
            
            if (!mapping) {
                objectiveFeedback.push({
                    ...objective,
                    question: 'No guide question set',
                    averageRating: null,
                    comments: []
                });
                continue;
            }
            
            // Get answers for this specific objective question
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-objectives')
                .select(`
                    objectiveQualInput, 
                    objectiveQuantInput, 
                    created_at,
                    feedback_answerObjectivesId
                `)
                .eq('feedback_qObjectivesId', mapping.feedback_qObjectivesId);
                
            if (answersError) {
                console.error('Error fetching objective answers:', answersError);
                continue;
            }
            
            // Calculate average rating for this objective
            let totalRating = 0;
            let validRatings = 0;
            
            for (const answer of answers || []) {
                if (answer.objectiveQuantInput && answer.objectiveQuantInput > 0) {
                    totalRating += answer.objectiveQuantInput;
                    validRatings++;
                }
            }
            
            const objAverageRating = validRatings > 0 ? totalRating / validRatings : null;
            
            // Format comments
            const comments = (answers || []).map(answer => ({
                text: answer.objectiveQualInput || "No comment provided",
                submittedOn: answer.created_at,
                responderType: 'Anonymous'
            }));
            
            objectiveFeedback.push({
                ...objective,
                question: mapping.objectiveQualiQuestion || 'No guide question set',
                averageRating: objAverageRating,
                comments: comments
            });
        }
        
        // 12. Get skills data for the specific job
        const { data: skills, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', jobId);
            
        if (skillsError) {
            console.error('Error fetching skills:', skillsError);
        }
        
        // 13. Get skill questions mapping
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
        }
        
        // 14. Build skills feedback
        const skillsFeedback = [];
        
        for (const skill of skills || []) {
            const mapping = (skillQuestionsMapping || []).find(q => q.jobReqSkillId === skill.jobReqSkillId);
            
            if (!mapping) {
                skillsFeedback.push({
                    skillName: skill.jobReqSkillName,
                    skillType: skill.jobReqSkillType,
                    averageRating: null,
                    responseCount: 0
                });
                continue;
            }
            
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-skills')
                .select(`
                    skillsQuantInput, 
                    skillsQualInput,
                    created_at,
                    feedback_answerSkillsId
                `)
                .eq('feedback_qSkillsId', mapping.feedback_qSkillsId);
                
            if (answersError) {
                console.error('Error fetching skill answers:', answersError);
                continue;
            }
            
            // Calculate average rating
            let totalRating = 0;
            let validRatings = 0;
            
            for (const answer of answers || []) {
                if (answer.skillsQuantInput && answer.skillsQuantInput > 0) {
                    totalRating += answer.skillsQuantInput;
                    validRatings++;
                }
            }
            
            const skillAverageRating = validRatings > 0 ? totalRating / validRatings : null;
            
            skillsFeedback.push({
                skillName: skill.jobReqSkillName,
                skillType: skill.jobReqSkillType,
                averageRating: skillAverageRating,
                responseCount: validRatings
            });
        }
        
        // 15. FIXED: Build individual answers using complete join like your SQL
        const individualAnswers = [];
        
        console.log(`Fetching individual answers for userId: ${userId}, quarter: ${quarter}`);
        
        // Get all feedback answers for this user and quarter
        const { data: allFeedbackAnswers, error: allFeedbackAnswersError } = await supabase
            .from('feedbacks_answers')
            .select(`
                feedbackId_answerId,
                ${feedbackIdField},
                userId,
                reviewerUserId,
                reviewDate,
                remarks
            `)
            .eq(feedbackIdField, feedbackId)
            .not('reviewerUserId', 'is', null);
            
        if (allFeedbackAnswersError) {
            console.error('Error fetching all feedback answers:', allFeedbackAnswersError);
            return res.status(500).json({
                success: false,
                message: "Error retrieving feedback answers."
            });
        }
        
        console.log(`Found ${allFeedbackAnswers?.length || 0} feedback answers`);
        
        // Group by unique reviewers
        const reviewerGroups = new Map();
        
        for (const feedbackAnswer of allFeedbackAnswers || []) {
            if (!reviewerGroups.has(feedbackAnswer.reviewerUserId)) {
                reviewerGroups.set(feedbackAnswer.reviewerUserId, []);
            }
            reviewerGroups.get(feedbackAnswer.reviewerUserId).push(feedbackAnswer);
        }
        
        console.log(`Found ${reviewerGroups.size} unique reviewers`);
        
        // Process each unique reviewer with FIXED data fetching using your SQL approach
        for (const [reviewerUserId, answers] of reviewerGroups) {
            console.log(`Processing reviewer ${reviewerUserId} with ${answers.length} answer records`);
            
            // Get reviewer info from staffaccounts
            const { data: reviewerData, error: reviewerError } = await supabase
                .from('staffaccounts')
                .select(`
                    userId,
                    firstName,
                    lastName,
                    jobId,
                    jobpositions!inner (jobTitle)
                `)
                .eq('userId', reviewerUserId)
                .single();
            
            if (reviewerError) {
                console.error('Error fetching reviewer data:', reviewerError);
                continue;
            }
            
            // Get all answer IDs from this reviewer
            const reviewerAnswerIds = answers.map(a => a.feedbackId_answerId);
            console.log(`Reviewer ${reviewerUserId} answer IDs:`, reviewerAnswerIds);
            
            // FIXED: Use the same SQL approach for objective answers
            // This replicates your working SQL query structure
            const { data: rawObjectiveData, error: objDataError } = await supabase
                .rpc('get_objective_feedback_data', {
                    target_user_id: parseInt(userId),
                    target_quarter: quarter,
                    target_year: feedbackData.year || new Date().getFullYear(),
                    target_reviewer_id: reviewerUserId
                });
            
            // Fallback if RPC doesn't exist - use manual joins like your SQL
            let objectiveAnswersData = [];
            if (objDataError || !rawObjectiveData) {
                console.log('Using fallback method for objective data...');
                
                // Manual approach replicating your SQL
                const { data: objAnswers, error: objError } = await supabase
                    .from('feedbacks_answers-objectives')
                    .select(`
                        objectiveQualInput,
                        objectiveQuantInput,
                        feedback_qObjectivesId,
                        feedback_answerObjectivesId,
                        created_at
                    `)
                    .in('feedback_answerObjectivesId', reviewerAnswerIds);
                
                if (!objError && objAnswers) {
                    // Now get the complete data by joining with questions and objectives
                    for (const objAnswer of objAnswers) {
                        // Find the question mapping
                        const questionMapping = (objectiveQuestionsMapping || []).find(q => 
                            q.feedback_qObjectivesId === objAnswer.feedback_qObjectivesId
                        );
                        
                        if (questionMapping) {
                            // Find the objective details
                            const objective = (objectives || []).find(o => 
                                o.objectiveId === questionMapping.objectiveId
                            );
                            
                            if (objective) {
                                objectiveAnswersData.push({
                                    ...objAnswer,
                                    objectiveId: questionMapping.objectiveId,
                                    objectiveDescrpt: objective.objectiveDescrpt,
                                    objectiveKPI: objective.objectiveKPI,
                                    objectiveTarget: objective.objectiveTarget,
                                    objectiveUOM: objective.objectiveUOM,
                                    objectiveAssignedWeight: objective.objectiveAssignedWeight,
                                    objectiveQualiQuestion: questionMapping.objectiveQualiQuestion
                                });
                            }
                        }
                    }
                }
            } else {
                objectiveAnswersData = rawObjectiveData;
            }
            
            // FIXED: Use the same SQL approach for skill answers
            const { data: rawSkillData, error: skillDataError } = await supabase
                .rpc('get_skill_feedback_data', {
                    target_user_id: parseInt(userId),
                    target_quarter: quarter,
                    target_year: feedbackData.year || new Date().getFullYear(),
                    target_reviewer_id: reviewerUserId
                });
            
            // Fallback if RPC doesn't exist - use manual joins like your SQL
            let skillAnswersData = [];
            if (skillDataError || !rawSkillData) {
                console.log('Using fallback method for skill data...');
                
                // Manual approach replicating your SQL
                const { data: skillAnswers, error: skillError } = await supabase
                    .from('feedbacks_answers-skills')
                    .select(`
                        skillsQualInput,
                        skillsQuantInput,
                        feedback_qSkillsId,
                        feedback_answerSkillsId,
                        created_at
                    `)
                    .in('feedback_answerSkillsId', reviewerAnswerIds);
                
                if (!skillError && skillAnswers) {
                    // Now get the complete data by joining with questions and skills
                    for (const skillAnswer of skillAnswers) {
                        // Find all skill question mappings for this feedback
                        const skillMappings = (skillQuestionsMapping || []).filter(q => 
                            q.feedback_qSkillsId === skillAnswer.feedback_qSkillsId
                        );
                        
                        // For each mapping, get the skill details
                        for (const mapping of skillMappings) {
                            const skill = (skills || []).find(s => 
                                s.jobReqSkillId === mapping.jobReqSkillId
                            );
                            
                            if (skill) {
                                skillAnswersData.push({
                                    ...skillAnswer,
                                    jobReqSkillId: mapping.jobReqSkillId,
                                    jobReqSkillName: skill.jobReqSkillName,
                                    jobReqSkillType: skill.jobReqSkillType
                                });
                            }
                        }
                    }
                }
            } else {
                skillAnswersData = rawSkillData;
            }
            
            console.log(`Found ${objectiveAnswersData.length} objective answers and ${skillAnswersData.length} skill answers for reviewer ${reviewerUserId}`);
            
            // Format objective answers
            const formattedObjAnswers = objectiveAnswersData.map(obj => ({
                objectiveId: obj.objectiveId,
                objectiveName: obj.objectiveDescrpt || 'Unknown Objective',
                objectiveKPI: obj.objectiveKPI || 'N/A',
                objectiveTarget: obj.objectiveTarget || 'N/A',
                objectiveUOM: obj.objectiveUOM || 'N/A',
                objectiveWeight: obj.objectiveAssignedWeight || 0,
                guideQuestion: obj.objectiveQualiQuestion || 'No guide question',
                rating: obj.objectiveQuantInput,
                comment: obj.objectiveQualInput || 'No comment provided',
                submittedDate: obj.created_at
            }));
            
            // Format skill answers
            const formattedSkillRatings = {};
            const formattedSkillComments = {};
            
            skillAnswersData.forEach(skill => {
                const skillKey = skill.jobReqSkillName;
                
                formattedSkillRatings[skillKey] = {
                    rating: skill.skillsQuantInput,
                    skillType: skill.jobReqSkillType,
                    skillId: skill.jobReqSkillId,
                    submittedDate: skill.created_at
                };
                
                formattedSkillComments[skillKey] = {
                    comment: skill.skillsQualInput || 'No comment provided',
                    skillType: skill.jobReqSkillType,
                    skillId: skill.jobReqSkillId,
                    submittedDate: skill.created_at
                };
            });
            
            // Determine responder type
            let responderType = 'Peer';
            if (reviewerUserId === parseInt(userId)) {
                responderType = 'Self';
            }
            
            // Build comprehensive individual answer object
            const individualAnswer = {
                responderId: reviewerUserId,
                responderName: reviewerData ? `${reviewerData.firstName} ${reviewerData.lastName}` : 'Anonymous',
                responderFirstName: reviewerData?.firstName || 'Unknown',
                responderLastName: reviewerData?.lastName || 'Unknown',
                responderJobTitle: reviewerData?.jobpositions?.jobTitle || 'Unknown Position',
                responderType: responderType,
                submittedDate: answers[0]?.reviewDate || answers[0]?.created_at,
                totalObjectiveAnswers: formattedObjAnswers.length,
                totalSkillAnswers: Object.keys(formattedSkillRatings).length,
                objectiveAnswers: formattedObjAnswers,
                skillRatings: formattedSkillRatings,
                skillComments: formattedSkillComments
            };
            
            individualAnswers.push(individualAnswer);
            
            console.log(`Added reviewer ${reviewerUserId}: ${formattedObjAnswers.length} objectives, ${Object.keys(formattedSkillRatings).length} skills`);
        }
        
        // Sort individual answers by submission date (most recent first)
        individualAnswers.sort((a, b) => {
            const dateA = new Date(a.submittedDate || 0);
            const dateB = new Date(b.submittedDate || 0);
            return dateB - dateA;
        });
        
        console.log(`=== INDIVIDUAL ANSWERS SUMMARY ===`);
        console.log(`Total reviewers: ${individualAnswers.length}`);
        individualAnswers.forEach((answer, index) => {
            console.log(`Reviewer ${index + 1}: ${answer.responderName} - ${answer.totalObjectiveAnswers} objectives, ${answer.totalSkillAnswers} skills`);
        });
        console.log(`=== END SUMMARY ===`);
        
        // 16. Generate filter options
        const questionFilterOptions = [
            { value: 'all', label: 'All Questions' }
        ];
        
        // Add objectives to filter
        if (objectives && objectives.length > 0) {
            objectives.forEach(obj => {
                questionFilterOptions.push({
                    value: `obj_${obj.objectiveId}`,
                    label: `Objective: ${obj.objectiveDescrpt || 'Unnamed Objective'}`
                });
            });
        }
        
        // Add skills to filter - group by type
        if (skills && skills.length > 0) {
            // Add Hard Skills section header
            const hardSkills = skills.filter(skill => skill.jobReqSkillType === 'Hard');
            if (hardSkills.length > 0) {
                questionFilterOptions.push({
                    value: 'hard_skills',
                    label: '--- Hard Skills ---'
                });
                hardSkills.forEach(skill => {
                    questionFilterOptions.push({
                        value: `hard_${skill.jobReqSkillId}`,
                        label: `Hard Skill: ${skill.jobReqSkillName}`
                    });
                });
            }
            
            // Add Soft Skills section header
            const softSkills = skills.filter(skill => skill.jobReqSkillType === 'Soft');
            if (softSkills.length > 0) {
                questionFilterOptions.push({
                    value: 'soft_skills',
                    label: '--- Soft Skills ---'
                });
                softSkills.forEach(skill => {
                    questionFilterOptions.push({
                        value: `soft_${skill.jobReqSkillId}`,
                        label: `Soft Skill: ${skill.jobReqSkillName}`
                    });
                });
            }
        }
        
        // SIMPLIFIED: Responder filter options with individual names only
        const responderFilterOptions = [
            { value: 'all', label: 'All Responders' }
        ];
        
        // Add individual responders only
        individualAnswers.forEach(answer => {
            responderFilterOptions.push({
                value: answer.responderId.toString(),
                label: `${answer.responderFirstName} ${answer.responderLastName} (${answer.responderJobTitle})`
            });
        });
        
        // 17. Return the compiled data
        return res.status(200).json({
            success: true,
            stats: {
                totalResponses,
                averageRating: averageRating.toFixed(1),
                completionRate: `${completionRate}%`,
                departmentStaffCount: totalStaffInDept,
                departmentResponseCount: departmentResponseCount,
                uniqueReviewersCount: uniqueReviewers.size
            },
            objectiveFeedback,
            skillsFeedback,
            individualAnswers,
            questionFilterOptions,
            responderFilterOptions, // Simplified - no type groups
            departmentStaff: departmentStaff.map(staff => ({
                userId: staff.userId,
                name: `${staff.firstName} ${staff.lastName}`,
                jobTitle: staff.jobpositions?.jobTitle || 'Unknown Position'
            })),
            meta: {
                feedbackId,
                quarter,
                startDate: feedbackData.setStartDate,
                endDate: feedbackData.setEndDate,
                departmentName: targetUserData.departments?.deptName,
                targetUserName: `${targetUserData.firstName} ${targetUserData.lastName}`,
                targetUserJobTitle: targetUserData.jobpositions?.jobTitle
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

// Fixed helper function - should be a standalone function, not using 'this'
determineResponderType: function(reviewerUserId, targetUserId, departmentStaff) {
    if (reviewerUserId === targetUserId) {
        return 'Self';
    }
    
    // You can add more logic here to determine if it's a manager, peer, or direct report
    // For now, we'll return 'Peer' as default
    return 'Peer';
},
save360Questionnaire: async function(req, res) {
    try {
        console.log("=== ENTERING save360Questionnaire ===");
        console.log("Request body:", JSON.stringify(req.body, null, 2));
        console.log("Request params:", req.params);
        
        // Get userId from params (URL) first, then from body as fallback
        let userId = req.params.userId || req.body.userId;
        
        // Extract other fields from request body
        let { startDate, endDate, jobId, feedbackData, quarter, activeQuarter } = req.body;
        
        // Handle quarter field - use activeQuarter if quarter is not provided
        if (!quarter && activeQuarter) {
            quarter = activeQuarter;
        }
        
        console.log("Extracted values:", {
            userId: userId,
            startDate: startDate,
            endDate: endDate,
            jobId: jobId,
            quarter: quarter,
            feedbackDataExists: !!feedbackData,
            feedbackDataContent: feedbackData
        });

        // Validate userId first
        if (!userId) {
            console.error("❌ User ID is missing from both params and body");
            // Check if this is an AJAX request
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(400).json({ 
                    success: false, 
                    message: "User ID is required. Please check the request URL or body." 
                });
            } else {
                return res.redirect('back');
            }
        }

        // Convert userId to integer if it's a string
        userId = parseInt(userId);
        if (isNaN(userId)) {
            console.error("❌ Invalid userId format:", req.params.userId || req.body.userId);
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Invalid User ID format." 
                });
            } else {
                return res.redirect('back');
            }
        }

        console.log("✅ Valid userId:", userId);

        // Step 1: Fetch the jobId if not provided
        let completeJobId = jobId;
        if (!completeJobId) {
            console.log("📋 jobId is missing, fetching from staffaccounts...");
            const { data: staffAccountData, error } = await supabase
                .from("staffaccounts")
                .select("jobId")
                .eq("userId", userId)
                .single();

            if (error) {
                console.error("❌ Error fetching jobId:", error);
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(500).json({ 
                        success: false, 
                        message: `Error fetching job information: ${error.message}` 
                    });
                } else {
                    return res.redirect('back');
                }
            }

            if (!staffAccountData || !staffAccountData.jobId) {
                console.error("❌ No jobId found for the user.");
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(400).json({ 
                        success: false, 
                        message: "Job ID not found for the user. Please ensure the user has a valid job assignment." 
                    });
                } else {
                    return res.redirect('back');
                }
            }

            completeJobId = staffAccountData.jobId;
            console.log("✅ Fetched jobId:", completeJobId);
        }

        // Step 2: Validate required fields
        if (!completeJobId || !startDate || !endDate || !quarter) {
            console.error('❌ Validation error: Missing required fields', { 
                completeJobId, 
                startDate, 
                endDate, 
                quarter,
                hasFeedbackData: !!feedbackData
            });
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Missing required fields: userId, jobId, startDate, endDate, and quarter are required.' 
                });
            } else {
                return res.redirect('back');
            }
        }

        // FIXED: Better handling of feedbackData
        if (!feedbackData) {
            console.log("⚠️ No feedbackData provided, creating empty structure");
            feedbackData = { questions: [] };
        }

        if (!feedbackData.questions) {
            feedbackData.questions = [];
        }

        console.log("📝 FeedbackData questions count:", feedbackData.questions.length);
        console.log("📝 FeedbackData questions detailed:", feedbackData.questions.map((q, i) => ({
            index: i,
            objectiveId: q.objectiveId,
            questionText: q.questionText,
            questionLength: q.questionText ? q.questionText.length : 0
        })));

        // Ensure quarter format is correct (Q1, Q2, Q3, Q4)
        let formattedQuarter = quarter;
        if (!quarter.startsWith('Q')) {
            formattedQuarter = `Q${quarter}`;
        }

        // Determine the feedback table based on the quarter
        const feedbackTable = `feedbacks_${formattedQuarter}`;
        const feedbackKey = `feedback${formattedQuarter.toLowerCase()}_Id`;
        
        console.log("🗂️ Using table:", feedbackTable, "with key:", feedbackKey);

        // Step 3: Check if feedback already exists
        console.log("🔍 Checking for existing feedback...");
        const { data: existingFeedback, error: existingError } = await supabase
            .from(feedbackTable)
            .select('*')
            .eq('userId', userId)
            .eq('jobId', completeJobId)
            .eq('quarter', formattedQuarter)
            .eq('year', new Date().getFullYear())
            .maybeSingle();

        if (existingError) {
            console.error("❌ Error checking existing feedback:", existingError);
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: `Error checking existing feedback: ${existingError.message}` 
                });
            } else {
                return res.redirect('back');
            }
        }

        let feedbackId;
        const dateCreated = new Date();

        if (existingFeedback) {
            console.log(`📝 Updating existing feedback in ${feedbackTable}...`);
            const { data: updateData, error: updateError } = await supabase
                .from(feedbackTable)
                .update({
                    setStartDate: new Date(startDate),
                    setEndDate: new Date(endDate),
                    dateCreated: dateCreated,
                })
                .eq('userId', userId)
                .eq('jobId', completeJobId)
                .eq('quarter', formattedQuarter)
                .eq('year', new Date().getFullYear())
                .select(feedbackKey);

            if (updateError) {
                console.error(`❌ Error updating feedback in ${feedbackTable}:`, updateError);
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Error updating feedback. Please try again.',
                        error: updateError.message 
                    });
                } else {
                    return res.redirect('back');
                }
            }

            feedbackId = existingFeedback[feedbackKey];
            console.log("✅ Updated existing feedback with ID:", feedbackId);
        } else {
            console.log(`➕ Inserting new feedback into ${feedbackTable}...`);
            const { data: feedbackInsertData, error: feedbackInsertError } = await supabase
                .from(feedbackTable)
                .insert({
                    userId: userId,
                    jobId: completeJobId,
                    setStartDate: new Date(startDate),
                    setEndDate: new Date(endDate),
                    dateCreated: dateCreated,
                    year: new Date().getFullYear(),
                    quarter: formattedQuarter
                })
                .select(feedbackKey);

            if (feedbackInsertError) {
                console.error(`❌ Error inserting into ${feedbackTable}:`, feedbackInsertError);
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Error saving feedback. Please try again.',
                        error: feedbackInsertError.message 
                    });
                } else {
                    return res.redirect('back');
                }
            }

            if (!feedbackInsertData || feedbackInsertData.length === 0) {
                console.error("❌ No data returned from feedback insert");
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Error saving feedback - no data returned.' 
                    });
                } else {
                    return res.redirect('back');
                }
            }

            feedbackId = feedbackInsertData[0][feedbackKey];
            console.log("✅ Inserted new feedback with ID:", feedbackId);
        }

        // Step 4: Get objectives from the correct tables with proper JOIN
        console.log("📋 Fetching objectives for the user/job...");
        
        // First get the objectiveSettingsId for this user/job
        const { data: objectiveSettings, error: objectiveSettingsError } = await supabase
            .from('objectivesettings')
            .select('objectiveSettingsId')
            .eq('userId', userId)
            .eq('jobId', completeJobId);

        if (objectiveSettingsError) {
            console.error("❌ Error fetching objective settings:", objectiveSettingsError);
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: `Error fetching objective settings: ${objectiveSettingsError.message}` 
                });
            } else {
                return res.redirect('back');
            }
        }

        console.log("📋 Found objective settings:", objectiveSettings);

        let allObjectives = [];
        
        if (objectiveSettings && objectiveSettings.length > 0) {
            // Get all objectiveSettingsIds for this user
            const objectiveSettingsIds = objectiveSettings.map(setting => setting.objectiveSettingsId);
            console.log("📋 Objective Settings IDs:", objectiveSettingsIds);
            
            // Now get the actual objectives from objectivesettings_objectives
            const { data: objectives, error: objectivesError } = await supabase
                .from('objectivesettings_objectives')
                .select('objectiveId, objectiveDescrpt, objectiveKPI, objectiveTarget, objectiveUOM, objectiveAssignedWeight, objectiveSettingsId')
                .in('objectiveSettingsId', objectiveSettingsIds);

            if (objectivesError) {
                console.error("❌ Error fetching objectives:", objectivesError);
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(500).json({ 
                        success: false, 
                        message: `Error fetching objectives: ${objectivesError.message}` 
                    });
                } else {
                    return res.redirect('back');
                }
            }

            allObjectives = objectives || [];
            console.log("📋 Found objectives:", allObjectives);
        }

        let savedQuestionsCount = 0; // FIXED: Declare this variable outside the if block
        
        if (allObjectives && allObjectives.length > 0) {
            console.log(`📋 Processing guide questions for ${allObjectives.length} objectives...`);
            
            // Clear existing guide questions for this feedback first
            console.log("🗑️ Clearing existing guide questions...");
            const { error: deleteError } = await supabase
                .from('feedbacks_questions-objectives')
                .delete()
                .eq(feedbackKey, feedbackId);

            if (deleteError) {
                console.error("❌ Error deleting existing guide questions:", deleteError);
                // Continue anyway - don't fail the entire operation
            } else {
                console.log("✅ Cleared existing guide questions");
            }

            // FIXED: Process each objective with enhanced guide question handling
            for (const objective of allObjectives) {
                const objectiveId = objective.objectiveId;
                
                // ENHANCED: Get guide question from multiple possible sources
                let guideQuestion = '';
                
                // Method 1: Check feedbackData structure (new format)
                if (feedbackData.questions && feedbackData.questions.length > 0) {
                    const questionData = feedbackData.questions.find(q => {
                        const qObjectiveId = parseInt(q.objectiveId);
                        const targetObjectiveId = parseInt(objectiveId);
                        console.log(`🔍 Comparing question objectiveId ${qObjectiveId} with target ${targetObjectiveId}`);
                        return qObjectiveId === targetObjectiveId;
                    });
                    
                    if (questionData && questionData.questionText !== undefined && questionData.questionText !== null) {
                        guideQuestion = questionData.questionText.toString().trim();
                        console.log(`📝 Found guide question from feedbackData for objective ${objectiveId}: "${guideQuestion}"`);
                    }
                }
                
                // Method 2: Check individual form fields (fallback for form submissions)
                if (!guideQuestion) {
                    const fieldName = `guideQuestion_${objectiveId}`;
                    if (req.body[fieldName] !== undefined && req.body[fieldName] !== null) {
                        guideQuestion = req.body[fieldName].toString().trim();
                        console.log(`📝 Found guide question from form field ${fieldName} for objective ${objectiveId}: "${guideQuestion}"`);
                    } else {
                        console.log(`⚠️ No guide question found for objective ${objectiveId} in either feedbackData or form fields`);
                    }
                }

                // FIXED: Always save the guide question with proper handling
                console.log(`➕ Inserting guide question for objectiveId=${objectiveId}: "${guideQuestion}" (length: ${guideQuestion.length})`);
                
                const insertData = {
                    [feedbackKey]: feedbackId,
                    objectiveId: parseInt(objectiveId),
                    objectiveQualiQuestion: guideQuestion || null // Use null for empty strings if needed
                };
                
                console.log("📝 Insert data for guide question:", insertData);
                
                const { data: insertedData, error: mappingInsertError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .insert(insertData)
                    .select();

                if (mappingInsertError) {
                    console.error(`❌ Error inserting guide question for objectiveId=${objectiveId}:`, mappingInsertError);
                    if (req.headers.accept && req.headers.accept.includes('application/json')) {
                        return res.status(500).json({ 
                            success: false,
                            message: `Error inserting guide question: ${mappingInsertError.message}`,
                            error: mappingInsertError 
                        });
                    } else {
                        return res.redirect('back');
                    }
                }
                
                console.log(`✅ Successfully inserted guide question for objectiveId=${objectiveId}:`, insertedData);
                savedQuestionsCount++;
            }
            
            console.log(`✅ Successfully processed ${savedQuestionsCount} guide questions`);
        } else {
            console.log("⚠️ No objectives found for this user/job");
        }

        // Step 5: Handle skills mapping
        console.log("🔧 Fetching job skills...");
        const { data: jobReqSkills, error: skillFetchError } = await supabase
            .from('jobreqskills')
            .select('jobReqSkillId, jobReqSkillName, jobReqSkillType')
            .eq('jobId', completeJobId);

        if (skillFetchError) {
            console.error("❌ Error fetching jobReqSkills:", skillFetchError);
            if (req.headers.accept && req.headers.accept.includes('application/json')) {
                return res.status(500).json({ 
                    success: false, 
                    message: "Error fetching job skills.",
                    error: skillFetchError.message 
                });
            } else {
                return res.redirect('back');
            }
        }

        if (jobReqSkills && jobReqSkills.length > 0) {
            console.log(`🔧 Mapping ${jobReqSkills.length} skills to feedback...`);
            
            // Clear existing skill mappings first
            const { error: deleteSkillsError } = await supabase
                .from('feedbacks_questions-skills')
                .delete()
                .eq(feedbackKey, feedbackId);

            if (deleteSkillsError) {
                console.error("❌ Error clearing existing skill mappings:", deleteSkillsError);
            }
            
            for (const jobReqSkill of jobReqSkills) {
                const { jobReqSkillId } = jobReqSkill;

                console.log(`➕ Inserting skill mapping for jobReqSkillId=${jobReqSkillId}`);
                const { error: skillMappingInsertError } = await supabase
                    .from('feedbacks_questions-skills')
                    .insert({
                        [feedbackKey]: feedbackId,
                        jobReqSkillId: jobReqSkillId
                    });

                if (skillMappingInsertError) {
                    console.error("❌ Error inserting skill mapping:", skillMappingInsertError);
                    if (req.headers.accept && req.headers.accept.includes('application/json')) {
                        return res.status(500).json({ 
                            success: false, 
                            message: "Error inserting skill mapping.",
                            error: skillMappingInsertError.message 
                        });
                    } else {
                        return res.redirect('back');
                    }
                }
                console.log(`✅ Inserted skill mapping for jobReqSkillId=${jobReqSkillId}`);
            }
        } else {
            console.log('⚠️ No jobReqSkills found for the job.');
        }

        console.log("=== save360Questionnaire COMPLETED SUCCESSFULLY ===");
        
        // FIXED: Check if this is an AJAX request or form submission
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            // Return JSON for AJAX calls
            return res.status(200).json({ 
                success: true, 
                message: 'Feedback questionnaire saved successfully!',
                feedbackId: feedbackId,
                quarter: formattedQuarter,
                savedQuestions: savedQuestionsCount,
                totalObjectives: allObjectives.length,
                details: {
                    startDate: startDate,
                    endDate: endDate,
                    userId: userId,
                    jobId: completeJobId
                }
            });
        } else {
            // Redirect for form submissions
            return res.redirect(`/linemanager/records-performance-tracker/${userId}`);
        }

    } catch (error) {
        console.error('❌ CRITICAL ERROR in save360Questionnaire:', error);
        
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(500).json({ 
                success: false, 
                message: 'An error occurred while saving the questionnaire.',
                error: error.message 
            });
        } else {
            return res.redirect('back');
        }
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

   // Enhanced checkFeedbackStatus with better error handling
checkFeedbackStatus: async function(req, res) {
    const { userId, quarter } = req.query;
    const reviewerUserId = req.session?.user?.userId;
    
    if (!userId || !quarter || !reviewerUserId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameters: userId, quarter, and reviewerUserId are required'
        });
    }
    
    try {
        // Get the correct table and field names
        const feedbackTable = `feedbacks_${quarter}`;
        const feedbackIdField = `feedbackq${quarter.substring(1)}_Id`;
        
        // Get feedback data for the user
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`userId, ${feedbackIdField}`)
            .eq('userId', userId)
            .eq('quarter', quarter)
            .single();
            
        if (feedbackError || !feedbackData) {
            return res.status(404).json({
                success: false,
                message: `No ${quarter} feedback data found for this user`
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        
        if (!feedbackId) {
            return res.status(404).json({
                success: false,
                message: `Feedback ID not found for ${quarter}`
            });
        }
        
        // Check if the reviewer has already submitted feedback
        const { data: reviewData, error: reviewError } = await supabase
            .from('feedbacks_answers')
            .select('feedbackId_answerId, reviewDate')
            .eq(feedbackIdField, feedbackId)
            .eq('reviewerUserId', reviewerUserId);
            
        if (reviewError) {
            console.error('Error checking review status:', reviewError);
            return res.status(500).json({
                success: false,
                message: 'Error checking review status'
            });
        }
        
        const submitted = reviewData && reviewData.length > 0;
        
        return res.json({
            success: true,
            submitted,
            submissionDate: submitted ? reviewData[0].reviewDate : null,
            feedbackId: feedbackId
        });
        
    } catch (error) {
        console.error('Error in checkFeedbackStatus:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while checking feedback status'
        });
    }
},

getDepartmentFeedbackStats: async function(departmentId) {
    try {
        console.log('🔍 Getting department feedback stats for department:', departmentId);
        
        // Get all employees in department
        const { data: employees, error: empError } = await supabase
            .from('staffaccounts')
            .select('userId')
            .eq('departmentId', departmentId);

        if (empError) {
            console.error('Error fetching department employees:', empError);
            return { totalEmployees: 0, employeesWithFeedback: 0, completedQuarters: [] };
        }

        console.log('📊 Found employees in department:', employees?.length || 0);
        
        const employeeIds = employees?.map(emp => emp.userId) || [];
        const currentYear = new Date().getFullYear();
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        
        let totalEmployeesWithFeedback = new Set(); // Use Set to avoid duplicates
        const completedQuarters = [];

        // Check each quarter for feedback completion
        for (const quarter of quarters) {
            const feedbackTable = `feedbacks_${quarter}`;
            
            try {
                console.log(`🔍 Checking table: ${feedbackTable} for year: ${currentYear}`);
                
                const { data: quarterFeedback, error: quarterError } = await supabase
                    .from(feedbackTable)
                    .select('userId')
                    .in('userId', employeeIds)
                    .eq('quarter', quarter)
                    .eq('year', currentYear);

                if (quarterError) {
                    console.log(`⚠️ Error or table doesn't exist: ${feedbackTable}`, quarterError);
                    continue;
                }

                if (quarterFeedback && quarterFeedback.length > 0) {
                    console.log(`✅ Found ${quarterFeedback.length} feedback records in ${quarter}`);
                    
                    completedQuarters.push({
                        quarter: quarter,
                        employeeCount: quarterFeedback.length
                    });
                    
                    // Add unique employee IDs to our set
                    quarterFeedback.forEach(fb => totalEmployeesWithFeedback.add(fb.userId));
                } else {
                    console.log(`📝 No feedback found for ${quarter} ${currentYear}`);
                }
            } catch (tableError) {
                console.log(`❌ Table ${feedbackTable} might not exist:`, tableError.message);
            }
        }

        const stats = {
            totalEmployees: employees?.length || 0,
            employeesWithFeedback: totalEmployeesWithFeedback.size,
            completedQuarters: completedQuarters,
            currentYear: currentYear
        };
        
        console.log('📈 Final stats:', stats);
        return stats;

    } catch (error) {
        console.error('❌ Error getting department feedback stats:', error);
        return { totalEmployees: 0, employeesWithFeedback: 0, completedQuarters: [] };
    }
},

// Modify the submitFeedback method to properly store feedback answers
submitFeedback: async function(req, res) {
    const currentUserId = req.session?.user?.userId;
    const { userId, quarter, feedbackResponses } = req.body;
    
    if (!currentUserId || !userId || !quarter || !feedbackResponses) {
        return res.status(400).json({
            success: false,
            message: 'Missing required data for feedback submission'
        });
    }
    
    try {
        // Get feedback table info
        const feedbackTable = `feedbacks_${quarter}`;
        const feedbackIdField = `feedbackq${quarter.substring(1)}_Id`;
        
        // Get the feedback record
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`${feedbackIdField}`)
            .eq('userId', userId)
            .eq('quarter', quarter)
            .single();
            
        if (feedbackError || !feedbackData) {
            return res.status(404).json({
                success: false,
                message: 'Feedback record not found'
            });
        }
        
        const feedbackId = feedbackData[feedbackIdField];
        
        // Check if already submitted
        const { data: existingSubmission, error: existingError } = await supabase
            .from('feedbacks_answers')
            .select('feedbackId_answerId')
            .eq(feedbackIdField, feedbackId)
            .eq('reviewerUserId', currentUserId)
            .limit(1);
            
        if (existingSubmission && existingSubmission.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Feedback already submitted for this user and quarter'
            });
        }
        
        // Create main feedback answer record
        const { data: answerRecord, error: answerError } = await supabase
            .from('feedbacks_answers')
            .insert({
                [feedbackIdField]: feedbackId,
                reviewerUserId: currentUserId,
                userId: userId, // Note: this field name might need correction in DB
                reviewDate: new Date().toISOString().split('T')[0],
                remarks: feedbackResponses.generalRemarks || null
            })
            .select('feedbackId_answerId')
            .single();
            
        if (answerError || !answerRecord) {
            console.error('Error creating feedback answer record:', answerError);
            return res.status(500).json({
                success: false,
                message: 'Error saving feedback submission'
            });
        }
        
        const answerId = answerRecord.feedbackId_answerId;
        
        // Save objective responses
        if (feedbackResponses.objectives && feedbackResponses.objectives.length > 0) {
            const objectiveAnswers = feedbackResponses.objectives.map(obj => ({
                feedback_answerObjectivesId: answerId,
                feedback_qObjectivesId: obj.questionId,
                objectiveQualInput: obj.qualitativeResponse,
                objectiveQuantInput: obj.quantitativeRating
            }));
            
            const { error: objError } = await supabase
                .from('feedbacks_answers-objectives')
                .insert(objectiveAnswers);
                
            if (objError) {
                console.error('Error saving objective answers:', objError);
                // You might want to rollback the main answer record here
            }
        }
        
        // Save skill responses
        if (feedbackResponses.skills && feedbackResponses.skills.length > 0) {
            const skillAnswers = feedbackResponses.skills.map(skill => ({
                feedback_answerSkillsId: answerId,
                feedback_qSkillsId: skill.questionId,
                skillsQualInput: skill.qualitativeResponse,
                skillsQuantInput: skill.quantitativeRating
            }));
            
            const { error: skillError } = await supabase
                .from('feedbacks_answers-skills')
                .insert(skillAnswers);
                
            if (skillError) {
                console.error('Error saving skill answers:', skillError);
                // You might want to rollback here as well
            }
        }
        
        return res.json({
            success: true,
            message: 'Feedback submitted successfully',
            answerId: answerId
        });
        
    } catch (error) {
        console.error('Error in submitFeedback:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while submitting feedback'
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
        console.log(`[${new Date().toISOString()}] Starting getLineManagerNotifications for user: ${req.session.user.userId}`);
        
        // Get the line manager's department ID first
        const lineManagerId = req.session.user.userId;
        const { data: lineManagerData, error: lineManagerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerId)
            .single();

        if (lineManagerError) {
            console.error(`[${new Date().toISOString()}] Error fetching line manager department:`, lineManagerError);
            throw lineManagerError;
        }

        const lineManagerDepartmentId = lineManagerData?.departmentId;
        console.log(`[${new Date().toISOString()}] Line manager department ID: ${lineManagerDepartmentId}`);

        if (!lineManagerDepartmentId) {
            console.error(`[${new Date().toISOString()}] Line manager has no department assigned`);
            return res.status(400).json({ error: 'Department not assigned to your account' });
        }

        // Fetch applicants awaiting Line Manager action (P1 status) 
        console.log(`[${new Date().toISOString()}] Fetching P1 applicants for department: ${lineManagerDepartmentId}`);
        const { data: p1Applicants, error: p1ApplicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
            .eq('applicantStatus', 'P1 - Awaiting for Line Manager Action; HR PASSED')
            .eq('departmentId', lineManagerDepartmentId)
            .order('created_at', { ascending: false });

        if (p1ApplicantsError) {
            console.error(`[${new Date().toISOString()}] Error fetching P1 applicants:`, p1ApplicantsError);
            throw p1ApplicantsError;
        }
        console.log(`[${new Date().toISOString()}] Found ${p1Applicants?.length || 0} P1 applicants`);

        // Fetch applicants awaiting Line Manager evaluation (P3 status) 
        console.log(`[${new Date().toISOString()}] Fetching P3 applicants for department: ${lineManagerDepartmentId}`);
        const { data: p3Applicants, error: p3ApplicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId, departmentId')
            .eq('applicantStatus', 'P3 - Awaiting for Line Manager Evaluation')
            .eq('departmentId', lineManagerDepartmentId)
            .order('created_at', { ascending: false });

        if (p3ApplicantsError) {
            console.error(`[${new Date().toISOString()}] Error fetching P3 applicants:`, p3ApplicantsError);
            throw p3ApplicantsError;
        }
        console.log(`[${new Date().toISOString()}] Found ${p3Applicants?.length || 0} P3 applicants`);

        // Combine the applicants
        const allApplicants = [...p1Applicants, ...p3Applicants];
        console.log(`[${new Date().toISOString()}] Total applicants: ${allApplicants.length}`);

        // Format the applicants data
        const formattedApplicants = allApplicants.map(applicant => ({
            id: applicant.applicantId,
            firstName: applicant.firstName || 'N/A',
            lastName: applicant.lastName || 'N/A',
            status: applicant.applicantStatus || 'N/A',
            jobId: applicant.jobId,
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
        console.log(`[${new Date().toISOString()}] Fetching leave requests for department: ${lineManagerDepartmentId}`);
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

        if (leaveError) {
            console.error(`[${new Date().toISOString()}] Error fetching leave requests:`, leaveError);
            throw leaveError;
        }

        // Filter leave requests to only include those from the line manager's department
        const filteredLeaveRequests = leaveRequests.filter(leave => 
            leave.useraccounts?.staffaccounts[0]?.departmentId === lineManagerDepartmentId
        );
        console.log(`[${new Date().toISOString()}] Found ${filteredLeaveRequests.length} leave requests for department`);

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
        console.log(`[${new Date().toISOString()}] Fetching offboarding requests for department: ${lineManagerDepartmentId}`);
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
            console.error(`[${new Date().toISOString()}] Error fetching offboarding requests:`, offboardingError);
            throw offboardingError;
        }

        // Filter offboarding requests to only include those from the line manager's department
        const filteredOffboardingRequests = offboardingRequests.filter(request => 
            request.useraccounts?.staffaccounts[0]?.departmentId === lineManagerDepartmentId
        );
        console.log(`[${new Date().toISOString()}] Found ${filteredOffboardingRequests.length} offboarding requests for department`);

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

        // ======= TRAINING REQUESTS FETCHING WITH SEPARATE QUERIES =======
        console.log(`[${new Date().toISOString()}] Starting to fetch training requests for department: ${lineManagerDepartmentId}`);
        
        let formattedTrainingRequests = [];
        
        try {
            // First, let's check if the training_records table exists and what columns it has
            const { data: tableCheck, error: tableCheckError } = await supabase
                .from('training_records')
                .select('*')
                .limit(1);

            if (tableCheckError) {
                if (tableCheckError.code === '42P01') {
                    console.log(`[${new Date().toISOString()}] training_records table does not exist`);
                } else {
                    console.error(`[${new Date().toISOString()}] Error checking training_records table:`, tableCheckError);
                }
                // Continue with empty array if table doesn't exist
            } else {
                console.log(`[${new Date().toISOString()}] training_records table exists, proceeding with query`);
                
                // First, get all staff in the line manager's department
                console.log(`[${new Date().toISOString()}] Fetching staff in department: ${lineManagerDepartmentId}`);
                const { data: departmentStaff, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select(`
                        userId,
                        firstName,
                        lastName,
                        jobId,
                        departmentId
                    `)
                    .eq('departmentId', lineManagerDepartmentId);

                if (staffError) {
                    console.error(`[${new Date().toISOString()}] Error fetching department staff:`, staffError);
                    throw staffError;
                }

                console.log(`[${new Date().toISOString()}] Found ${departmentStaff?.length || 0} staff members in department`);

                // Separately fetch job titles for the staff if needed
                let jobTitles = {};
                if (departmentStaff && departmentStaff.length > 0) {
                    const jobIds = [...new Set(departmentStaff.map(staff => staff.jobId).filter(Boolean))];
                    if (jobIds.length > 0) {
                        const { data: jobPositions, error: jobError } = await supabase
                            .from('jobpositions')
                            .select('jobId, jobTitle')
                            .in('jobId', jobIds);
                        
                        if (!jobError && jobPositions) {
                            jobPositions.forEach(job => {
                                jobTitles[job.jobId] = job.jobTitle;
                            });
                        }
                    }
                }

                // Get user IDs for department staff
                const departmentUserIds = departmentStaff.map(staff => staff.userId);
                console.log(`[${new Date().toISOString()}] Department user IDs:`, departmentUserIds);

                if (departmentUserIds.length === 0) {
                    console.log(`[${new Date().toISOString()}] No staff found in department, skipping training requests`);
                } else {
                    // Now fetch training requests for these users
                    console.log(`[${new Date().toISOString()}] Executing training requests query with filters:`);
                    console.log(`- status: 'For Line Manager Endorsement' (enum)`);
                    console.log(`- userId in: [${departmentUserIds.join(', ')}]`);

                    const { data: trainingRequests, error: trainingError } = await supabase
                        .from('training_records')
                        .select(`
                            trainingRecordId,
                            userId,
                            jobId,
                            dateRequested,
                            isApproved,
                            status,
                            trainingName,
                            trainingDesc
                        `)
                        .eq('status', 'For Line Manager Endorsement')
                        .in('userId', departmentUserIds)
                        .order('dateRequested', { ascending: true });

                    if (trainingError) {
                        console.error(`[${new Date().toISOString()}] Error in training requests query:`, trainingError);
                        console.error(`[${new Date().toISOString()}] Error details:`, {
                            code: trainingError.code,
                            message: trainingError.message,
                            details: trainingError.details,
                            hint: trainingError.hint
                        });
                    } else {
                        console.log(`[${new Date().toISOString()}] Training requests query successful`);
                        console.log(`[${new Date().toISOString()}] Raw training requests data:`, JSON.stringify(trainingRequests, null, 2));
                        console.log(`[${new Date().toISOString()}] Found ${trainingRequests?.length || 0} training requests matching criteria`);

                        if (trainingRequests && trainingRequests.length > 0) {
                            // Create a lookup map for staff details
                            const staffLookup = {};
                            departmentStaff.forEach(staff => {
                                staffLookup[staff.userId] = {
                                    ...staff,
                                    jobTitle: jobTitles[staff.jobId] || 'N/A'
                                };
                            });

                            // Log each training request for debugging
                            trainingRequests.forEach((request, index) => {
                                const staffDetails = staffLookup[request.userId];
                                console.log(`[${new Date().toISOString()}] Training Request ${index + 1}:`, {
                                    trainingRecordId: request.trainingRecordId,
                                    userId: request.userId,
                                    jobId: request.jobId,
                                    status: request.status,
                                    isApproved: request.isApproved,
                                    firstName: staffDetails?.firstName,
                                    lastName: staffDetails?.lastName,
                                    jobTitle: staffDetails?.jobTitle,
                                    trainingName: request.trainingName
                                });
                            });

                            // Format training requests with staff details
                            formattedTrainingRequests = trainingRequests.map((request, index) => {
                                const staffDetails = staffLookup[request.userId];
                                const formatted = {
                                    userId: request.userId,
                                    trainingRecordId: request.trainingRecordId,
                                    firstName: staffDetails?.firstName || 'Employee',
                                    lastName: staffDetails?.lastName || '',
                                    jobTitle: staffDetails?.jobTitle || 'N/A',
                                    trainingName: request.trainingName || 'N/A',
                                    dateRequested: request.dateRequested ? new Date(request.dateRequested).toLocaleString('en-US', {
                                        weekday: 'short',
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                    }) : 'Recent',
                                    status: request.status || 'For Line Manager Endorsement',
                                    isApproved: request.isApproved,
                                    date: request.dateRequested
                                };
                                
                                console.log(`[${new Date().toISOString()}] Formatted Training Request ${index + 1}:`, formatted);
                                return formatted;
                            });
                        } else {
                            console.log(`[${new Date().toISOString()}] No training requests found matching the criteria`);
                        }
                    }
                }
            }
        } catch (trainingFetchError) {
            console.error(`[${new Date().toISOString()}] Unexpected error in training requests section:`, trainingFetchError);
            console.error(`[${new Date().toISOString()}] Training fetch error stack:`, trainingFetchError.stack);
        }

        console.log(`[${new Date().toISOString()}] Final formatted training requests count: ${formattedTrainingRequests.length}`);

        // Calculate total notification count
        const notificationCount = formattedApplicants.length + 
                                 formattedLeaveRequests.length + 
                                 formattedOffboardingRequests.length +
                                 formattedTrainingRequests.length;

        console.log(`[${new Date().toISOString()}] Total notification count: ${notificationCount}`);
        console.log(`[${new Date().toISOString()}] Breakdown - Applicants: ${formattedApplicants.length}, Leave: ${formattedLeaveRequests.length}, Offboarding: ${formattedOffboardingRequests.length}, Training: ${formattedTrainingRequests.length}`);

        // Prepare response data
        const responseData = {
            success: true,
            data: {
                applicants: formattedApplicants,
                leaveRequests: formattedLeaveRequests,
                offboardingRequests: formattedOffboardingRequests,
                trainingRequests: formattedTrainingRequests,
                notificationCount: notificationCount
            }
        };

        // If it's an API request, return JSON
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
            console.log(`[${new Date().toISOString()}] Returning JSON response`);
            return res
                .header('Content-Type', 'application/json')
                .json(responseData);
        }

        // Otherwise, return the rendered partial template
        console.log(`[${new Date().toISOString()}] Rendering partial template`);
        return res.render('partials/linemanager_partials', responseData.data);

    } catch (err) {
        console.error(`[${new Date().toISOString()}] Error in getLineManagerNotifications:`, err);
        console.error(`[${new Date().toISOString()}] Error stack:`, err.stack);
        
        // Better error handling for API requests
        if (req.xhr || req.headers.accept?.includes('application/json') || req.path.includes('/api/')) {
            return res
                .status(500)
                .header('Content-Type', 'application/json')
                .json({ 
                    success: false,
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
    console.log("=== Employee staffFeedbackList function called ===");
    const currentUserId = req.session?.user?.userId;
    const quarter = req.query.quarter || 'Q1';
    
    console.log("🔍 Current User ID:", currentUserId);
    console.log("🔍 Requested Quarter:", quarter);
    
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
            console.error("❌ Error fetching user details:", userError);
            return res.status(404).json({
                success: false,
                error: 'User Not Found',
                message: 'Unable to retrieve your user information.'
            });
        }
        
        const { departmentId } = currentUserData;
        console.log("✅ Current user:", currentUserData.firstName, currentUserData.lastName);
        console.log("🏢 Department ID:", departmentId, "Name:", currentUserData.departments?.deptName);
        
        // Fetch ALL staff members in the same department (excluding current user)
        const { data: allDepartmentStaff, error: staffError } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName,
                jobId,
                jobpositions (jobTitle)
            `)
            .eq('departmentId', departmentId)
            .neq('userId', currentUserId); // Exclude current user
        
        if (staffError) {
            console.error("❌ Error fetching staff list:", staffError);
            return res.status(500).json({
                success: false,
                error: 'Data Fetch Error',
                message: 'Unable to retrieve department staff list.'
            });
        }
        
        console.log(`📊 Found ${allDepartmentStaff?.length || 0} department colleagues:`);
        allDepartmentStaff?.forEach((staff, index) => {
            console.log(`  ${index + 1}. ${staff.firstName} ${staff.lastName} (ID: ${staff.userId}, JobID: ${staff.jobId})`);
        });
        
        // Get the list of users who have complete feedback data for each quarter
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const usersWithDataByQuarter = {};
        
        for (const q of quarters) {
            usersWithDataByQuarter[q] = [];
            
            // Get feedback table and ID field for this quarter
            const feedbackTable = `feedbacks_${q}`;
            const feedbackIdField = `feedbackq${q.substring(1)}_Id`;
            
            console.log(`\n🔍 Checking ${feedbackTable} for quarter ${q}...`);
            
            // For each department staff member, check if they have complete feedback setup
            for (const staff of allDepartmentStaff || []) {
                const { userId: staffUserId, jobId: staffJobId } = staff;
                
                console.log(`  🔍 Checking user ${staffUserId} (${staff.firstName} ${staff.lastName})...`);
                
                // Check if user has feedback record for this quarter
                const { data: feedbackData, error: feedbackError } = await supabase
                    .from(feedbackTable)
                    .select(`${feedbackIdField}, userId, quarter`)
                    .eq('userId', staffUserId)
                    .eq('quarter', q)
                    .single();
                    
                if (feedbackError || !feedbackData) {
                    console.log(`    ❌ No feedback record found in ${feedbackTable}`);
                    continue;
                }
                
                const feedbackId = feedbackData[feedbackIdField];
                console.log(`    ✅ Found feedback record with ID ${feedbackId}`);
                
                // Check for objectives questions
                const { data: objectivesData, error: objectivesError } = await supabase
                    .from('feedbacks_questions-objectives')
                    .select('feedback_qObjectivesId, objectiveId')
                    .eq(feedbackIdField, feedbackId);
                
                // Check for skills questions  
                const { data: skillsData, error: skillsError } = await supabase
                    .from('feedbacks_questions-skills')
                    .select('feedback_qSkillsId, jobReqSkillId')
                    .eq(feedbackIdField, feedbackId);
                
                const hasObjectives = !objectivesError && objectivesData?.length > 0;
                const hasSkills = !skillsError && skillsData?.length > 0;
                const hasCompleteData = hasObjectives && hasSkills;
                
                console.log(`    📋 Objectives: ${hasObjectives ? '✅' : '❌'} (${objectivesData?.length || 0})`);
                console.log(`    🛠️ Skills: ${hasSkills ? '✅' : '❌'} (${skillsData?.length || 0})`);
                console.log(`    📊 Complete: ${hasCompleteData ? '✅' : '❌'}`);
                
                if (hasCompleteData) {
                    usersWithDataByQuarter[q].push(staffUserId);
                    console.log(`    ✅ Added user ${staffUserId} to ${q} available list`);
                }
            }
            
            console.log(`  📊 ${q} available users: [${usersWithDataByQuarter[q].join(', ')}]`);
        }
        
        // Format the staff list with quarter availability info
        const formattedStaffList = allDepartmentStaff.map(staff => {
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
        
        const hasQuarterData = filteredStaffList.length > 0;
        
        console.log(`\n📈 FINAL RESULTS for ${quarter}:`);
        console.log(`  Department: ${currentUserData.departments?.deptName} (ID: ${departmentId})`);
        console.log(`  Total department colleagues: ${allDepartmentStaff?.length || 0}`);
        console.log(`  Available colleagues for feedback: ${filteredStaffList.length}`);
        
        if (filteredStaffList.length > 0) {
            console.log(`  ✅ Available for ${quarter} feedback:`);
            filteredStaffList.forEach((staff, index) => {
                console.log(`    ${index + 1}. ${staff.firstName} ${staff.lastName} (${staff.userId}) - ${staff.jobTitle}`);
            });
        } else {
            console.log(`  ❌ No colleagues available for ${quarter} feedback`);
        }
        
        // Show quarter availability summary
        console.log("\n📊 Quarter availability summary:");
        quarters.forEach(q => {
            const count = formattedStaffList.filter(staff => staff.availableQuarters[q]).length;
            console.log(`  ${q}: ${count} colleagues available`);
        });
        
        console.log("\n✅ Rendering page...");
        
        return res.render('staffpages/employee_pages/employee-quarterlyfeedbackquestionnaire.ejs', {
            title: '360 Degree Feedback Questionnaires',
            quarter: quarter,
            staffList: filteredStaffList,
            allStaffList: formattedStaffList,
            hasQuarterData: hasQuarterData,
            user: req.session.user,
            debug: {
                currentUserId: currentUserId,
                departmentId: departmentId,
                departmentName: currentUserData.departments?.deptName,
                totalDepartmentStaff: allDepartmentStaff?.length || 0,
                availableColleagues: filteredStaffList.length,
                selectedQuarter: quarter
            }
        });
        
    } catch (error) {
        console.error('❌ Error in staffFeedbackList:', error);
        return res.status(500).json({
            success: false,
            error: 'Server Error',
            message: 'An unexpected error occurred. Please try again later.'
        });
    }
},

getQuestionnaireData: async function (req, res) {
    const currentUserId = req.session?.user?.userId;
    const targetUserId = req.query.userId;
    const quarter = req.query.quarter || 'Q1';
    
    console.log("=== getQuestionnaireData called ===");
    console.log("🔍 Current User ID:", currentUserId);
    console.log("🔍 Target User ID:", targetUserId);
    console.log("🔍 Quarter:", quarter);
    
    if (!currentUserId || !targetUserId) {
        return res.status(400).json({ 
            success: false, 
            message: 'User IDs are required.'
        });
    }
    
    try {
        // Get table name and ID field based on quarter
        const quarterTable = `feedbacks_${quarter}`;
        const idField = `feedbackq${quarter.substring(1)}_Id`;
        
        console.log(`📋 Using table: ${quarterTable}, ID field: ${idField}`);
        
        // Fetch feedback data for the target user
        const { data: feedbackData, error: feedbackError } = await supabase
            .from(quarterTable)
            .select(`
                userId, 
                setStartDate, 
                setEndDate, 
                ${idField},
                quarter,
                year,
                jobId
            `)
            .eq('userId', targetUserId)
            .eq('quarter', quarter)
            .order('created_at', { ascending: false })
            .limit(1);

        if (feedbackError || !feedbackData || feedbackData.length === 0) {
            console.error(`❌ Error fetching feedback data from ${quarterTable}:`, feedbackError);
            return res.status(404).json({ 
                success: false, 
                message: 'No feedback data found for this user in this quarter.'
            });
        }

        const feedback = feedbackData[0];
        const feedbackId = feedback[idField];

        console.log(`✅ Found feedback record with ID ${feedbackId}`);
        
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
            console.error("⚠️ Error fetching user data:", userError);
        } else if (userData) {
            feedback.deptName = userData.departments?.deptName;
            feedback.jobTitle = userData.jobpositions?.jobTitle;
            if (!feedback.jobId && userData.jobId) {
                feedback.jobId = userData.jobId;
            }
        }

        feedback.id = feedbackId;
        
        console.log(`📊 Feedback details:`, {
            id: feedbackId,
            userId: feedback.userId,
            quarter: feedback.quarter,
            year: feedback.year,
            jobId: feedback.jobId,
            startDate: feedback.setStartDate,
            endDate: feedback.setEndDate
        });
        
        // Fetch objectives for this feedback using the correct ID field
        const { data: objectivesData, error: objectivesError } = await supabase
            .from('feedbacks_questions-objectives')
            .select(`
                feedback_qObjectivesId,
                objectiveId,
                objectiveQualiQuestion,
                ${idField}
            `)
            .eq(idField, feedbackId);
            
        if (objectivesError) {
            console.error("❌ Error fetching objectives:", objectivesError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching objectives data.'
            });
        }

        console.log(`📋 Found ${objectivesData?.length || 0} objective questions`);
        
        // Get detailed objective information
        let objectives = [];
        if (objectivesData && objectivesData.length > 0) {
            const objectiveIds = objectivesData.map(obj => obj.objectiveId).filter(id => id);
            
            console.log(`🔍 Fetching details for objective IDs: [${objectiveIds.join(', ')}]`);
            
            if (objectiveIds.length > 0) {
                const { data: objectiveDetails, error: objectiveDetailsError } = await supabase
                    .from('objectivesettings_objectives')
                    .select('*')
                    .in('objectiveId', objectiveIds);
                    
                if (objectiveDetailsError) {
                    console.error("❌ Error fetching objective details:", objectiveDetailsError);
                } else if (objectiveDetails) {
                    console.log(`✅ Found ${objectiveDetails.length} objective details`);
                    
                    objectives = objectivesData.map(obj => {
                        const detail = objectiveDetails.find(d => d.objectiveId === obj.objectiveId);
                        return {
                            ...obj,
                            ...detail,
                            objectiveDescription: detail?.objectiveDescrpt,
                            description: detail?.objectiveDescrpt,
                            kpi: detail?.objectiveKPI,
                            target: detail?.objectiveTarget,
                            uom: detail?.objectiveUOM,
                            weight: detail?.objectiveAssignedWeight
                        };
                    });
                } else {
                    objectives = objectivesData;
                }
            } else {
                objectives = objectivesData;
            }
        }
        
        // Fetch skills questions for this feedback
        const { data: skillsQuestionsData, error: skillsQuestionsError } = await supabase
            .from('feedbacks_questions-skills')
            .select(`
                feedback_qSkillsId,
                jobReqSkillId,
                ${idField}
            `)
            .eq(idField, feedbackId);
            
        if (skillsQuestionsError) {
            console.error("❌ Error fetching skills questions:", skillsQuestionsError);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching skills questions data.'
            });
        }

        console.log(`🛠️ Found ${skillsQuestionsData?.length || 0} skills questions`);
        
        // Get detailed skill information
        let hardSkills = [];
        let softSkills = [];
        
        if (skillsQuestionsData && skillsQuestionsData.length > 0) {
            const skillIds = skillsQuestionsData.map(skill => skill.jobReqSkillId).filter(id => id);
            
            console.log(`🔍 Fetching details for skill IDs: [${skillIds.join(', ')}]`);
            
            if (skillIds.length > 0) {
                const { data: skillDetails, error: skillDetailsError } = await supabase
                    .from('jobreqskills')
                    .select('*')
                    .in('jobReqSkillId', skillIds);
                    
                if (skillDetailsError) {
                    console.error("❌ Error fetching skill details:", skillDetailsError);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Error fetching skills details.'
                    });
                }

                console.log(`✅ Found ${skillDetails?.length || 0} skill details`);

                // Map skills questions to detailed skill information
                const skillsWithDetails = skillsQuestionsData.map(skillQ => {
                    const detail = skillDetails?.find(d => d.jobReqSkillId === skillQ.jobReqSkillId);
                    return {
                        ...skillQ,
                        ...detail,
                        skillId: skillQ.jobReqSkillId // For consistency with frontend
                    };
                });

                // Separate hard and soft skills
                hardSkills = skillsWithDetails.filter(skill => skill.jobReqSkillType === 'Hard') || [];
                softSkills = skillsWithDetails.filter(skill => skill.jobReqSkillType === 'Soft') || [];
                
                console.log(`📊 Skills breakdown - Hard: ${hardSkills.length}, Soft: ${softSkills.length}`);
            }
        }

        // Check if feedback is already submitted by this reviewer
        const { data: existingFeedback, error: existingFeedbackError } = await supabase
            .from('feedbacks_answers')
            .select('feedbackId_answerId')
            .eq(idField, feedbackId)
            .eq('reviewerUserId', currentUserId)
            .limit(1);
            
        const isSubmitted = existingFeedback && existingFeedback.length > 0;
        console.log(`📝 Feedback already submitted by this reviewer: ${isSubmitted}`);

        console.log("\n📊 Final questionnaire data summary:");
        console.log(`  Objectives: ${objectives.length}`);
        console.log(`  Hard Skills: ${hardSkills.length}`);
        console.log(`  Soft Skills: ${softSkills.length}`);
        console.log(`  Already Submitted: ${isSubmitted}`);

        return res.json({
            success: true,
            feedback,
            objectives,
            hardSkills,
            softSkills,
            isSubmitted
        });
        
    } catch (error) {
        console.error('❌ Error in getQuestionnaireData:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'An error occurred while fetching questionnaire data.',
            error: error.message
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


// Function to fix the relationship between feedback answers and detailed responses
fixFeedbackAnswerRelationships: async function(feedbackId, feedbackIdField, quarter) {
    try {
        // Get all feedback answers for this feedback ID
        const { data: feedbackAnswers, error: answersError } = await supabase
            .from('feedbacks_answers')
            .select(`
                feedbackId_answerId,
                reviewerUserId,
                reviewDate,
                ${feedbackIdField}
            `)
            .eq(feedbackIdField, feedbackId);
            
        if (answersError) {
            console.error('Error fetching feedback answers:', answersError);
            return [];
        }
        
        const detailedAnswers = [];
        
        for (const answer of feedbackAnswers || []) {
            // Get objective answers
            const { data: objectiveAnswers, error: objError } = await supabase
                .from('feedbacks_answers-objectives')
                .select(`
                    objectiveQualInput,
                    objectiveQuantInput,
                    feedback_qObjectivesId
                `)
                .eq('feedback_answerObjectivesId', answer.feedbackId_answerId);
                
            // Get skill answers  
            const { data: skillAnswers, error: skillError } = await supabase
                .from('feedbacks_answers-skills')
                .select(`
                    skillsQualInput,
                    skillsQuantInput,
                    feedback_qSkillsId
                `)
                .eq('feedback_answerSkillsId', answer.feedbackId_answerId);
                
            detailedAnswers.push({
                ...answer,
                objectiveAnswers: objectiveAnswers || [],
                skillAnswers: skillAnswers || []
            });
        }
        
        return detailedAnswers;
        
    } catch (error) {
        console.error('Error fixing feedback answer relationships:', error);
        return [];
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
                year,
                jobId
            `)
            .eq('userId', targetUserId)
            .eq('quarter', quarter)
            .order('created_at', { ascending: false })
            .limit(1);

        if (feedbackError || !feedbackData || feedbackData.length === 0) {
            console.error(`Error fetching feedback data:`, feedbackError);
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
            feedback.deptName = userData.departments?.deptName;
            feedback.jobTitle = userData.jobpositions?.jobTitle;
            if (!feedback.jobId && userData.jobId) {
                feedback.jobId = userData.jobId;
            }
        }

        feedback.id = feedbackId;
        
        // Fetch objectives for this feedback using the correct ID field
        const { data: objectivesData, error: objectivesError } = await supabase
            .from('feedbacks_questions-objectives')
            .select(`
                feedback_qObjectivesId,
                objectiveId,
                objectiveQualiQuestion,
                ${idField}
            `)
            .eq(idField, feedbackId);
            
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
                
                objectives = objectivesData.map(obj => {
                    const detail = objectiveDetails.find(d => d.objectiveId === obj.objectiveId);
                    return {
                        ...obj,
                        ...detail,
                        objectiveDescription: detail?.objectiveDescrpt,
                        description: detail?.objectiveDescrpt,
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
        
        // Get job ID for skills fetching
        let jobId = feedback.jobId;
        if (!jobId && userData) {
            jobId = userData.jobId;
        }
        
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

        return res.json({
            success: true,
            feedback,
            objectives,
            hardSkills,
            softSkills,
            isSubmitted
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
                userId: userId, // Note: following the schema's 'userId' spelling
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

// createTraining: async function(req, res) {
//     console.log(`[${new Date().toISOString()}] Creating new training for user ${req.session?.user?.userId}`);
//     console.log('Request body:', req.body);

//     const {
//         trainingName,
//         trainingDesc,
//         jobId,
//         objectives,        // Array of objective IDs
//         skills,           // Array of skill IDs
//         isOnlineArrangement,
//         country,          // Country code for onsite training
//         address,          // Address for onsite training
//         cost,
//         totalDuration,
//         activities,
//         certifications
//     } = req.body;

//     const userId = req.session?.user?.userId;

//     if (!userId) {
//         return res.status(401).json({
//             success: false,
//             message: 'User not authenticated'
//         });
//     }

//     try {
//         // Validate required fields
//         if (!trainingName || !trainingDesc || !jobId) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Missing required fields: trainingName, trainingDesc, and jobId are required'
//             });
//         }

//         // UPDATED VALIDATION: Allow either objectives OR skills (at least one from either)
//         if ((!objectives || !Array.isArray(objectives) || objectives.length === 0) && 
//             (!skills || !Array.isArray(skills) || skills.length === 0)) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'At least one objective OR one skill must be selected'
//             });
//         }

//         // Validation: Check if onsite training has required location fields
//         if (isOnlineArrangement === false) {
//             if (!country || !address) {
//                 return res.status(400).json({
//                     success: false,
//                     message: 'Country and address are required for onsite training'
//                 });
//             }
//         }

//         console.log('Selected objectives:', objectives);
//         console.log('Selected skills:', skills);
//         console.log('Training mode online:', isOnlineArrangement);
//         console.log('Country:', country);
//         console.log('Address:', address);

//         // 1. Create the main training record in trainings table
//         const trainingData = {
//             trainingName,
//             trainingDesc,
//             jobId: parseInt(jobId),
//             userId: userId,
//             isOnlineArrangement: isOnlineArrangement || false,
//             cost: parseFloat(cost) || 0,
//             totalDuration: parseFloat(totalDuration) || 0,
//             isActive: true
//         };

//         // Add country and address for onsite training
//         if (isOnlineArrangement === false) {
//             trainingData.country = country;
//             trainingData.address = address;
//         } else {
//             // Set to null for online training
//             trainingData.country = null;
//             trainingData.address = null;
//         }

//         console.log('Training data to insert:', trainingData);

//         const { data: training, error: trainingError } = await supabase
//             .from('trainings')
//             .insert([trainingData])
//             .select()
//             .single();

//         if (trainingError) {
//             console.error('Error creating training:', trainingError);
//             throw new Error(`Failed to create training: ${trainingError.message}`);
//         }

//         const trainingId = training.trainingId;
//         console.log(`Training created with ID: ${trainingId}`);

//         // 2. Insert objectives into training_objectives table
//         if (objectives && objectives.length > 0) {
//             const formattedObjectives = objectives.map(objectiveId => ({
//                 trainingId: trainingId,
//                 objectiveId: parseInt(objectiveId)
//             }));

//             const { error: objectivesError } = await supabase
//                 .from('training_objectives')
//                 .insert(formattedObjectives);

//             if (objectivesError) {
//                 console.error('Error inserting training objectives:', objectivesError);
//                 throw new Error(`Failed to create objectives: ${objectivesError.message}`);
//             }
//             console.log(`Created ${objectives.length} objectives for training`);
//         }

//         // 3. Insert skills into training_skills table
//         if (skills && skills.length > 0) {
//             const formattedSkills = skills.map(skillId => ({
//                 trainingId: trainingId,
//                 jobReqSkillId: parseInt(skillId)
//             }));

//             const { error: skillsError } = await supabase
//                 .from('training_skills')
//                 .insert(formattedSkills);

//             if (skillsError) {
//                 console.error('Error inserting training skills:', skillsError);
//                 throw new Error(`Failed to create skills: ${skillsError.message}`);
//             }
//             console.log(`Created ${skills.length} skills for training`);
//         }

//         // 4. Insert activities into training_activities table
//         if (activities && activities.length > 0) {
//             const formattedActivities = activities.map((activity) => ({
//                 trainingId: trainingId,
//                 activityName: activity.name,
//                 estActivityDuration: parseFloat(activity.duration) || 0,
//                 activityType: activity.type,
//                 activityRemarks: activity.remarks || ''
//             }));

//             const { error: activitiesError } = await supabase
//                 .from('training_activities')
//                 .insert(formattedActivities);

//             if (activitiesError) {
//                 console.error('Error inserting training activities:', activitiesError);
//                 throw new Error(`Failed to create activities: ${activitiesError.message}`);
//             }
//             console.log(`Created ${activities.length} activities for training`);
//         }

//         // 5. Insert certifications
//         if (certifications && certifications.length > 0) {
//             const formattedCerts = certifications.map(cert => ({
//                 trainingId: trainingId,
//                 trainingCertTitle: cert.title,
//                 trainingCertDesc: cert.description
//             }));

//             const { error: certsError } = await supabase
//                 .from('training_certifications')
//                 .insert(formattedCerts);

//             if (certsError) {
//                 console.error('Error inserting training certifications:', certsError);
//                 throw new Error(`Failed to create certifications: ${certsError.message}`);
//             }
//             console.log(`Created ${certifications.length} certifications for training`);
//         }

//         // Return success response with created training data
//         const responseData = {
//             ...training,
//             activityCount: activities ? activities.length : 0,
//             certificationCount: certifications ? certifications.length : 0,
//             selectedObjectives: objectives ? objectives.length : 0,
//             selectedSkills: skills ? skills.length : 0
//         };

//         console.log(`[${new Date().toISOString()}] Training created successfully: ${trainingId}`);

//         res.status(201).json({
//             success: true,
//             message: 'Training created successfully',
//             data: responseData
//         });

//     } catch (error) {
//         console.error('Error in createTraining:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to create training',
//             error: error.message,
//             timestamp: new Date().toISOString()
//         });
//     }
// },
//     // Add new activity type
//     addActivityType: async function(req, res) {
//         const { activityType } = req.body;

//         try {
//             const { data, error } = await supabase
//                 .from('training_activities_types')
//                 .insert([{ activityType }])
//                 .select()
//                 .single();

//             if (error) throw error;

//             res.json({
//                 success: true,
//                 message: 'Activity type added successfully',
//                 data: data
//             });

//         } catch (error) {
//             console.error('Error in addActivityType:', error);
//             res.status(500).json({
//                 success: false,
//                 message: 'Failed to add activity type',
//                 error: error.message
//             });
//         }
//     },

    // // Fetch all trainings with related data
    // getAllTrainings: async function(req, res) {
    //     try {
    //         const { data: trainings, error: trainingsError } = await supabase
    //             .from('trainings')
    //             .select(`
    //                 *,
    //                 jobpositions (jobTitle),
    //                 objectivesettings_objectives (objectiveName),
    //                 jobreqskills (skillName),
    //                 useraccounts (firstName, lastName),
    //                 training_activities (*),
    //                 training_certifications (*)
    //             `)
    //             .eq('isActive', true)
    //             .order('trainingId', { ascending: false });

    //         if (trainingsError) throw trainingsError;

    //         res.json({
    //             success: true,
    //             data: trainings
    //         });

    //     } catch (error) {
    //         console.error('Error in getAllTrainings:', error);
    //         res.status(500).json({
    //             success: false,
    //             message: 'Failed to fetch trainings',
    //             error: error.message
    //         });
    //     }
    // },

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
                trainingName,
                trainingDesc,
                useraccounts!inner(
                    userEmail,
                    staffaccounts!inner(
                        firstName,
                        lastName,
                        departmentId
                    )
                )
            `)
            .is('isApproved', null) // Only get pending approvals
            .not('trainingStatus', 'eq', 'Cancelled') // Exclude cancelled requests
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
            trainingName: request.trainingName,
            dateRequested: new Date(request.dateRequested).toLocaleDateString('en-US', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            }),
            trainingStatus: request.trainingStatus,
            isApproved: request.isApproved,
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

// Updated getTrainingRequest function with enhanced logging
getTrainingRequest: async function(req, res) {
    const userId = req.session?.user?.userId;
    const userRole = req.session?.user?.userRole;

    console.log(`[${new Date().toISOString()}] getTrainingRequest called by user: ${userId}, role: ${userRole}`);

    if (!userId || userRole !== 'Line Manager') {
        console.log(`[${new Date().toISOString()}] Unauthorized access attempt - userId: ${userId}, role: ${userRole}`);
        req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
        return res.redirect('/staff/login');
    }

    const requestUserId = req.params.userId;
    const recordId = req.query.recordId;

    console.log(`[${new Date().toISOString()}] Training request parameters - requestUserId: ${requestUserId}, recordId: ${recordId}`);

    try {
        // If we have both userId and recordId, fetch the specific request data
        if (requestUserId && recordId) {
            console.log(`[${new Date().toISOString()}] Fetching specific training request with enum status 'For Approval'`);
            
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
                    )
                `)
                .eq('userId', requestUserId)
                .eq('trainingRecordId', recordId)
                .eq('trainingStatus', 'For Approval') // Enum value
                .is('isApproved', null)
                .single();

            if (error) {
                console.error(`[${new Date().toISOString()}] Error fetching training request:`, error);
                console.error(`[${new Date().toISOString()}] Query parameters used:`, {
                    userId: requestUserId,
                    recordId: recordId,
                    trainingStatus: 'For Approval',
                    isApproved: 'null'
                });
            }

            if (error || !trainingRequest) {
                console.log(`[${new Date().toISOString()}] Training request not found or already processed`);
                console.log(`[${new Date().toISOString()}] Error details:`, error);
                req.flash('errors', { notFound: 'Training request not found or already processed.' });
                return res.redirect('/linemanager/dashboard');
            }

            console.log(`[${new Date().toISOString()}] Successfully fetched training request:`, {
                trainingRecordId: trainingRequest.trainingRecordId,
                trainingStatus: trainingRequest.trainingStatus,
                isApproved: trainingRequest.isApproved,
                trainingName: trainingRequest.trainingName
            });

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
        console.error(`[${new Date().toISOString()}] Unexpected error in getTrainingRequest:`, error);
        console.error(`[${new Date().toISOString()}] Error stack:`, error.stack);
        req.flash('errors', { serverError: 'Error loading training request.' });
        res.redirect('/linemanager/dashboard');
    }
},
getTrainingRequestsForNotifications: async function(lineManagerUserId) {
    console.log(`[${new Date().toISOString()}] getTrainingRequestsForNotifications called for line manager: ${lineManagerUserId}`);
    
    try {
        // First, get the line manager's department ID
        console.log(`[${new Date().toISOString()}] Fetching line manager department info`);
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
        console.log(`[${new Date().toISOString()}] Line manager department ID: ${lineManagerDepartmentId}`);

        if (!lineManagerDepartmentId) {
            console.error(`[${new Date().toISOString()}] Line manager has no department assigned`);
            return [];
        }

        // Query to get training requests with enum status "For Approval" and isApproved = null
        console.log(`[${new Date().toISOString()}] Querying training requests with enum 'For Approval' status`);
        
        const { data: trainingRequests, error } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                userId,
                trainingId,
                dateRequested,
                isApproved,
                trainingStatus,
                trainingName,
                trainingDesc,
                useraccounts!inner(
                    userEmail,
                    staffaccounts!inner(
                        firstName,
                        lastName,
                        departmentId
                    )
                )
            `)
            .eq('trainingStatus', 'For Approval') // Enum value
            .is('isApproved', null)
            .eq('useraccounts.staffaccounts.departmentId', lineManagerDepartmentId)
            .order('dateRequested', { ascending: true });

        if (error) {
            console.error(`[${new Date().toISOString()}] Error fetching training requests:`, error);
            console.error(`[${new Date().toISOString()}] Query parameters:`, {
                trainingStatus: 'For Approval',
                isApproved: 'null',
                departmentId: lineManagerDepartmentId
            });
            return [];
        }

        console.log(`[${new Date().toISOString()}] Raw training requests query result:`, trainingRequests);
        console.log(`[${new Date().toISOString()}] Found ${trainingRequests?.length || 0} training requests`);

        if (!trainingRequests || trainingRequests.length === 0) {
            console.log(`[${new Date().toISOString()}] No training requests found for department ${lineManagerDepartmentId}`);
            return [];
        }

        // Transform the data to match frontend expectations
        const transformedRequests = trainingRequests.map((request, index) => {
            console.log(`[${new Date().toISOString()}] Processing training request ${index + 1}:`, {
                trainingRecordId: request.trainingRecordId,
                userId: request.userId,
                trainingStatus: request.trainingStatus,
                isApproved: request.isApproved,
                firstName: request.useraccounts?.staffaccounts?.firstName,
                lastName: request.useraccounts?.staffaccounts?.lastName,
                trainingName: request.trainingName
            });

            return {
                userId: request.userId,
                trainingRecordId: request.trainingRecordId,
                firstName: request.useraccounts.staffaccounts.firstName,
                lastName: request.useraccounts.staffaccounts.lastName,
                trainingName: request.trainingName,
                dateRequested: new Date(request.dateRequested).toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                }),
                trainingStatus: request.trainingStatus,
                isApproved: request.isApproved,
                // Keep original date for frontend sorting
                date: request.dateRequested
            };
        });

        console.log(`[${new Date().toISOString()}] Successfully transformed ${transformedRequests.length} training requests`);
        console.log(`[${new Date().toISOString()}] Final transformed requests:`, transformedRequests);
        
        return transformedRequests;

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Unexpected error in getTrainingRequestsForNotifications:`, error);
        console.error(`[${new Date().toISOString()}] Error stack:`, error.stack);
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

        // First, let's check what fields are available in training_records table
        console.log('Querying training_records with recordId:', recordId);

        // FIXED: Try multiple possible field names for the record ID
        let trainingRequest = null;
        let error = null;

        // Try with trainingRecordId first
        const { data: attempt1, error: error1 } = await supabase
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
                )
            `)
            .eq('userId', requestUserId)
            .eq('trainingRecordId', recordId)
            .is('isApproved', null)
            .single();

        if (attempt1) {
            trainingRequest = attempt1;
        } else {
            // Try with id field as fallback
            const { data: attempt2, error: error2 } = await supabase
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
                    )
                `)
                .eq('userId', requestUserId)
                .eq('id', recordId)
                .is('isApproved', null)
                .single();

            if (attempt2) {
                trainingRequest = attempt2;
            } else {
                // Try with recordId field as last resort
                const { data: attempt3, error: error3 } = await supabase
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
                        )
                    `)
                    .eq('userId', requestUserId)
                    .eq('recordId', recordId)
                    .is('isApproved', null)
                    .single();

                trainingRequest = attempt3;
                error = error3;
            }
        }

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
// approveTrainingRequest: async function(req, res) {
//     const userId = req.session?.user?.userId;
//     const userRole = req.session?.user?.userRole;

//     if (!userId || userRole !== 'Line Manager') {
//         return res.status(401).json({
//             success: false,
//             message: 'Unauthorized. Line Manager access only.',
//             timestamp: new Date().toISOString()
//         });
//     }

//     console.log(`[${new Date().toISOString()}] Line manager ${userId} approving training request`);

//     try {
//         const { remarks, trainingRecordId } = req.body;

//         if (!remarks || !remarks.trim()) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Remarks are required for approval',
//                 timestamp: new Date().toISOString()
//             });
//         }

//         if (!trainingRecordId) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Training record ID is required',
//                 timestamp: new Date().toISOString()
//             });
//         }

//         // Get training record with training and job position details
//         const { data: trainingRecord, error: fetchError } = await supabase
//             .from('training_records')
//             .select(`
//                 trainingId,
//                 userId,
//                 trainings(cost, jobId, jobpositions(departmentId))
//             `)
//             .eq('trainingRecordId', trainingRecordId)
//             .is('isApproved', null)
//             .single();

//         if (fetchError || !trainingRecord) {
//             console.error(`[${new Date().toISOString()}] Error fetching training record:`, fetchError);
//             return res.status(fetchError ? 500 : 404).json({
//                 success: false,
//                 message: fetchError ? 'Error fetching training record' : 'Training request not found or already processed',
//                 error: fetchError?.message,
//                 timestamp: new Date().toISOString()
//             });
//         }

//         // Verify we have all required data
//         if (!trainingRecord.trainings?.cost || !trainingRecord.trainings.jobpositions?.departmentId) {
//             console.error(`[${new Date().toISOString()}] Missing required data:`, {
//                 cost: trainingRecord.trainings?.cost,
//                 departmentId: trainingRecord.trainings.jobpositions?.departmentId
//             });
//             return res.status(400).json({
//                 success: false,
//                 message: 'Missing required training cost or department information',
//                 timestamp: new Date().toISOString()
//             });
//         }

//         const trainingCost = trainingRecord.trainings.cost;
//         const departmentId = trainingRecord.trainings.jobpositions.departmentId;

//         // Get current department training budget
//         const { data: budgetData, error: budgetError } = await supabase
//             .from('training_budgets')
//             .select('amount, trainingBugetId')
//             .eq('departmentId', departmentId)
//             .single();

//         if (budgetError || !budgetData) {
//             console.error(`[${new Date().toISOString()}] Error fetching training budget:`, budgetError);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Error fetching department training budget',
//                 error: budgetError?.message,
//                 timestamp: new Date().toISOString()
//             });
//         }

//         // Check budget sufficiency
//         if (budgetData.amount < trainingCost) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Insufficient training budget for approval',
//                 details: {
//                     required: trainingCost,
//                     available: budgetData.amount,
//                     departmentId: departmentId
//                 },
//                 timestamp: new Date().toISOString()
//             });
//         }

//         const approvedDate = new Date().toISOString().split('T')[0];

//         // Update training record
//         const { data: updatedRecord, error } = await supabase
//             .from('training_records')
//             .update({
//                 trainingStatus: 'Not Started',
//                 isApproved: true,
//                 decisionDate: approvedDate,
//                 decisionRemarks: remarks
//             })
//             .eq('trainingRecordId', trainingRecordId)
//             .is('isApproved', null)
//             .select()
//             .single();

//         if (error || !updatedRecord) {
//             console.error(`[${new Date().toISOString()}] Error approving training request:`, error);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to approve training request',
//                 error: error?.message,
//                 timestamp: new Date().toISOString()
//             });
//         }

//         // Deduct from budget
//         const newBudgetAmount = budgetData.amount - trainingCost;
//         const { error: budgetUpdateError } = await supabase
//             .from('training_budgets')
//             .update({ amount: newBudgetAmount })
//             .eq('trainingBugetId', budgetData.trainingBugetId);

//         if (budgetUpdateError) {
//             console.error(`[${new Date().toISOString()}] Error updating budget:`, budgetUpdateError);
            
//             // Rollback approval
//             await supabase
//                 .from('training_records')
//                 .update({
//                     trainingStatus: 'For Approval',
//                     isApproved: null,
//                     decisionDate: null,
//                     decisionRemarks: null
//                 })
//                 .eq('trainingRecordId', trainingRecordId);

//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to update training budget - approval rolled back',
//                 error: budgetUpdateError.message,
//                 timestamp: new Date().toISOString()
//             });
//         }

//         console.log(`[${new Date().toISOString()}] Approved training ${trainingRecordId}. Budget updated: ${budgetData.amount} -> ${newBudgetAmount}`);

//         res.json({
//             success: true,
//             message: 'Training request approved successfully!',
//             data: {
//                 trainingRecordId,
//                 trainingStatus: 'Not Started',
//                 isApproved: true,
//                 approvedBy: userId,
//                 decisionDate: approvedDate,
//                 decisionRemarks: remarks,
//                 budgetImpact: {
//                     departmentId,
//                     amountDeducted: trainingCost,
//                     remainingBudget: newBudgetAmount
//                 }
//             },
//             timestamp: new Date().toISOString()
//         });

//     } catch (error) {
//         console.error(`[${new Date().toISOString()}] Error in approval:`, error);
//         res.status(500).json({
//             success: false,
//             message: 'Internal server error during approval',
//             error: error.message,
//             timestamp: new Date().toISOString()
//         });
//     }
// },

// // Reject training request - REVISED
// rejectTrainingRequest: async function(req, res) {
//     const userId = req.session?.user?.userId;
//     const userRole = req.session?.user?.userRole;

//     if (!userId || userRole !== 'Line Manager') {
//         return res.status(401).json({
//             success: false,
//             message: 'Unauthorized. Line Manager access only.',
//             timestamp: new Date().toISOString()
//         });
//     }

//     console.log(`[${new Date().toISOString()}] Line manager ${userId} rejecting training request`);

//     try {
//         const { remarks, trainingRecordId, userId: requestUserId } = req.body;

//         if (!remarks || !remarks.trim()) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Remarks are required for rejection',
//                 timestamp: new Date().toISOString()
//             });
//         }

//         if (!trainingRecordId) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Training record ID is required',
//                 timestamp: new Date().toISOString()
//             });
//         }

//         const rejectedDate = new Date().toISOString().split('T')[0]; // Today's date

//         // REVISED: Update the training record with proper rejection status
//         const { data: updatedRecord, error } = await supabase
//             .from('training_records')
//             .update({
//                 trainingStatus: 'Not Started', // Keep as Not Started even when rejected
//                 isApproved: false, // Set to rejected
//                 decisionDate: rejectedDate, // Record decision date
//                 decisionRemarks: remarks // Record rejection remarks
//             })
//             .eq('trainingRecordId', trainingRecordId)
//             .is('isApproved', null) // Only update if still pending
//             .select() // Return the updated record
//             .single();

//         if (error) {
//             console.error(`[${new Date().toISOString()}] Error rejecting training request:`, error);
//             return res.status(500).json({
//                 success: false,
//                 message: 'Failed to reject training request',
//                 error: error.message,
//                 timestamp: new Date().toISOString()
//             });
//         }

//         // Check if any record was actually updated
//         if (!updatedRecord) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Training request not found or already processed',
//                 timestamp: new Date().toISOString()
//             });
//         }

//         console.log(`[${new Date().toISOString()}] Training request ${trainingRecordId} rejected successfully - Status: Not Started, Approved: false`);

//         res.json({
//             success: true,
//             message: 'Training request rejected successfully.',
//             data: {
//                 trainingRecordId,
//                 trainingStatus: 'Not Started',
//                 isApproved: false,
//                 rejectedBy: userId,
//                 decisionDate: rejectedDate,
//                 decisionRemarks: remarks
//             },
//             timestamp: new Date().toISOString()
//         });

//     } catch (error) {
//         console.error(`[${new Date().toISOString()}] Error in training rejection:`, error);
//         res.status(500).json({
//             success: false,
//             message: 'Internal server error during rejection',
//             error: error.message,
//             timestamp: new Date().toISOString()
//         });
//     }
// },

// // BONUS: Updated createTrainingRequest function to properly handle the initial status
// createTrainingRequest: async function(req, res) {
//     console.log(`[${new Date().toISOString()}] Creating training request for user ${req.session?.user?.userId}`);
//     console.log('Request body:', req.body);

//     try {
//         const userId = req.session?.user?.userId;
//         if (!userId) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'User not authenticated'
//             });
//         }

//         const { trainingId, startDate, endDate, scheduleType } = req.body;

//         // Validate required fields
//         if (!trainingId || !startDate || !endDate) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Training ID, start date, and end date are required'
//             });
//         }

//         // Validate dates
//         const start = new Date(startDate);
//         const end = new Date(endDate);
        
//         if (end <= start) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'End date must be after start date'
//             });
//         }

//         // Check if training exists and is active
//         const { data: training, error: trainingError } = await supabase
//             .from('trainings')
//             .select('trainingId, trainingName, isOnlineArrangement, totalDuration')
//             .eq('trainingId', parseInt(trainingId))
//             .eq('isActive', true)
//             .single();

//         if (trainingError || !training) {
//             console.error('Training not found or inactive:', trainingError);
//             return res.status(404).json({
//                 success: false,
//                 message: 'Training not found or inactive'
//             });
//         }

//         // Check for existing active requests
//         const { data: existingRequests, error: existingError } = await supabase
//             .from('training_records')
//             .select('trainingRecordId, setStartDate, setEndDate, trainingStatus, isApproved')
//             .eq('userId', userId)
//             .eq('trainingId', parseInt(trainingId))
//             .or('isApproved.is.null,isApproved.eq.true') // Pending or approved
//             .not('trainingStatus', 'eq', 'Completed'); // Exclude completed

//         if (existingError && existingError.code !== 'PGRST116') {
//             console.error('Error checking existing requests:', existingError);
//             throw new Error(`Failed to check existing requests: ${existingError.message}`);
//         }

//         // Check for conflicts
//         if (existingRequests && existingRequests.length > 0) {
//             const hasConflict = existingRequests.some(request => {
//                 // If there's a pending request (isApproved is null)
//                 if (request.isApproved === null) {
//                     return true; // Block duplicate pending requests
//                 }
                
//                 // If there's an approved request, check for date overlap
//                 if (request.isApproved === true) {
//                     const requestStart = new Date(request.setStartDate);
//                     const requestEnd = new Date(request.setEndDate);
//                     return (start <= requestEnd && end >= requestStart);
//                 }
                
//                 return false;
//             });

//             if (hasConflict) {
//                 const conflicting = existingRequests[0];
//                 const conflictType = conflicting.isApproved === null ? 'pending approval' : 'approved and overlapping';
//                 return res.status(400).json({
//                     success: false,
//                     message: `You already have a training request for this course that is ${conflictType}. Please check your existing requests.`
//                 });
//             }
//         }

//         // REVISED: Create training record with proper initial status
//         const trainingRecordData = {
//             userId: userId,
//             trainingId: parseInt(trainingId),
//             setStartDate: startDate,
//             setEndDate: endDate,
//             trainingStatus: 'Not Started', // Use proper enum value
//             isApproved: null, // Pending approval
//             dateRequested: new Date().toISOString().split('T')[0],
//             decisionDate: null, // Will be set when approved/rejected
//             decisionRemarks: scheduleType ? `Schedule Type: ${scheduleType}` : null
//         };

//         console.log('Creating training record with data:', trainingRecordData);

//         const { data: trainingRecord, error: recordError } = await supabase
//             .from('training_records')
//             .insert([trainingRecordData])
//             .select()
//             .single();

//         if (recordError) {
//             console.error('Error creating training record:', recordError);
//             throw new Error(`Failed to create training record: ${recordError.message}`);
//         }

//         const trainingRecordId = trainingRecord.trainingRecordId;
//         console.log(`Training record created with ID: ${trainingRecordId}`);

//         // Create activity records (same as before)
//         const { data: activities, error: activitiesError } = await supabase
//             .from('training_activities')
//             .select('activityId, activityName, estActivityDuration, activityType')
//             .eq('trainingId', parseInt(trainingId))
//             .order('activityId', { ascending: true });

//         let activitiesCreated = 0;
        
//         if (!activitiesError && activities && activities.length > 0) {
//             for (const activity of activities) {
//                 try {
//                     const activityRecordData = {
//                         trainingRecordId: trainingRecordId,
//                         activityId: activity.activityId,
//                         status: 'Not Started',
//                         timestampzStarted: null,
//                         timestampzCompleted: null
//                     };

//                     const { error: activityInsertError } = await supabase
//                         .from('training_records_activities')
//                         .insert([activityRecordData]);

//                     if (!activityInsertError) {
//                         activitiesCreated++;
//                     }
//                 } catch (activityError) {
//                     console.error(`Error creating activity record:`, activityError);
//                 }
//             }
//         }

//         console.log(`Training request created successfully: ${trainingRecordId} with ${activitiesCreated} activities`);

//         res.status(201).json({
//             success: true,
//             message: 'Training request submitted successfully and is pending approval',
//             data: {
//                 trainingRecordId: trainingRecordId,
//                 trainingName: training.trainingName,
//                 trainingStatus: 'Not Started',
//                 isApproved: null, // Pending
//                 scheduleType: scheduleType,
//                 activitiesCreated: activitiesCreated,
//                 totalActivitiesAvailable: activities ? activities.length : 0
//             }
//         });

//     } catch (error) {
//         console.error('Error in createTrainingRequest:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to create training request',
//             error: error.message,
//             timestamp: new Date().toISOString()
//         });
//     }
// },
// Get department employees for line manager reports
getDepartmentEmployeesForReports: async (req, res) => {
    try {
        console.log('🔄 [Line Manager] Fetching department employees for reports...');
        
        // Get the line manager's user ID from session
        const managerId = req.session.user?.userId;
        if (!managerId) {
            return res.status(401).json({
                success: false,
                message: 'Manager not authenticated'
            });
        }
        
        // Get the manager's department
        const { data: managerInfo, error: managerError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                departments (
                    deptName
                )
            `)
            .eq('userId', managerId)
            .single();
        
        if (managerError || !managerInfo) {
            console.error('❌ [Line Manager] Error fetching manager info:', managerError);
            return res.status(500).json({
                success: false,
                message: 'Failed to get manager department information'
            });
        }
        
        const managerDepartmentId = managerInfo.departmentId;
        console.log(`📍 [Line Manager] Manager department ID: ${managerDepartmentId}`);
        
        // Get all employees in the same department
        const { data: employees, error: employeeError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                departments (
                    deptName
                )
            `)
            .eq('departmentId', managerDepartmentId)
            .neq('userId', managerId) // Exclude the manager themselves
            .order('firstName', { ascending: true });
        
        if (employeeError) {
            console.error('❌ [Line Manager] Error fetching department employees:', employeeError);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch department employees: ' + employeeError.message
            });
        }
        
        // Format the data
        const formattedEmployees = (employees || []).map(emp => ({
            userId: emp.userId,
            firstName: emp.firstName,
            lastName: emp.lastName,
            department: emp.departments?.deptName || 'Unknown'
        }));
        
        console.log(`✅ [Line Manager] Found ${formattedEmployees.length} department employees`);
        
        res.json({
            success: true,
            employees: formattedEmployees,
            department: managerInfo.departments?.deptName || 'Unknown'
        });
        
    } catch (error) {
        console.error('❌ [Line Manager] Error in getDepartmentEmployeesForReports:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch department employees: ' + error.message
        });
    }
},

// Daily attendance report for manager's department
getDepartmentDailyAttendanceReport: async (req, res) => {
    try {
        const { attendanceDate } = req.query;
        const managerId = req.session.user?.userId;
        
        console.log(`🔄 [Line Manager] Generating department daily attendance report for ${attendanceDate}`);
        
        if (!attendanceDate) {
            return res.status(400).json({
                success: false,
                message: 'Attendance date is required'
            });
        }
        
        if (!managerId) {
            return res.status(401).json({
                success: false,
                message: 'Manager not authenticated'
            });
        }
        
        // Get manager's department
        const { data: managerInfo, error: managerError } = await supabase
            .from('staffaccounts')
            .select('departmentId, departments(deptName)')
            .eq('userId', managerId)
            .single();
        
        if (managerError || !managerInfo) {
            return res.status(500).json({
                success: false,
                message: 'Failed to get manager department'
            });
        }
        
        const departmentId = managerInfo.departmentId;
        const departmentName = managerInfo.departments?.deptName || 'Unknown';
        
        // Get all department staff
        const { data: departmentStaff, error: staffError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                jobpositions (
                    jobTitle
                )
            `)
            .eq('departmentId', departmentId);
        
        if (staffError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch department staff: ' + staffError.message
            });
        }
        
        // Get attendance for the department on the specified date
        const departmentUserIds = departmentStaff.map(staff => staff.userId);
        
        const { data: attendanceLogs, error: attendanceError } = await supabase
            .from('attendance')
            .select(`
                userId,
                attendanceTime,
                attendanceAction,
                city,
                attendanceDate
            `)
            .eq('attendanceDate', attendanceDate)
            .in('userId', departmentUserIds)
            .order('userId', { ascending: true })
            .order('attendanceTime', { ascending: true });
        
        if (attendanceError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch attendance data: ' + attendanceError.message
            });
        }
        
        // Get leave requests for the department on the same date
        const { data: leaveRequests, error: leaveError } = await supabase
            .from('leaverequests')
            .select(`
                userId,
                fromDate,
                untilDate,
                reason,
                leave_types (
                    typeName
                )
            `)
            .eq('status', 'Approved')
            .lte('fromDate', attendanceDate)
            .gte('untilDate', attendanceDate)
            .in('userId', departmentUserIds);
        
        if (leaveError) {
            console.error('❌ [Line Manager] Error fetching leave requests:', leaveError);
        }
        
        // Process the data (similar to HR function but department-specific)
        const attendanceMap = {};
        attendanceLogs.forEach(log => {
            if (!attendanceMap[log.userId]) {
                attendanceMap[log.userId] = [];
            }
            attendanceMap[log.userId].push(log);
        });
        
        const leaveMap = {};
        (leaveRequests || []).forEach(leave => {
            leaveMap[leave.userId] = leave;
        });
        
        // Process each department employee
        const detailedAttendance = [];
        let totalEmployees = departmentStaff.length;
        let present = 0;
        let onLeave = 0;
        let late = 0;
        let earlyOut = 0;
        
        departmentStaff.forEach(employee => {
            const empAttendance = attendanceMap[employee.userId] || [];
            const empLeave = leaveMap[employee.userId];
            
            let timeIn = null;
            let timeOut = null;
            let status = 'Absent';
            let lateMinutes = 0;
            let earlyOutMinutes = 0;
            let hoursWorked = 'N/A';
            
            if (empLeave) {
                status = 'On Leave';
                onLeave++;
            } else if (empAttendance.length > 0) {
                const timeInRecord = empAttendance.find(log => log.attendanceAction === 'Time In');
                const timeOutRecord = empAttendance.find(log => log.attendanceAction === 'Time Out');
                
                if (timeInRecord) {
                    timeIn = timeInRecord.attendanceTime;
                    status = 'Present';
                    
                    // Check if late (9:00 AM standard)
                    const standardTimeIn = '09:00:00';
                    if (timeIn > standardTimeIn) {
                        status = 'Late';
                        const timeInDate = new Date(`1970-01-01T${timeIn}`);
                        const standardDate = new Date(`1970-01-01T${standardTimeIn}`);
                        lateMinutes = Math.round((timeInDate - standardDate) / 60000);
                        late++;
                    } else {
                        present++;
                    }
                }
                
                if (timeOutRecord) {
                    timeOut = timeOutRecord.attendanceTime;
                    
                    // Check if early out (6:00 PM standard)
                    const standardTimeOut = '18:00:00';
                    if (timeOut < standardTimeOut) {
                        const timeOutDate = new Date(`1970-01-01T${timeOut}`);
                        const standardDate = new Date(`1970-01-01T${standardTimeOut}`);
                        earlyOutMinutes = Math.round((standardDate - timeOutDate) / 60000);
                        earlyOut++;
                    }
                }
                
                // Calculate hours worked
                if (timeIn && timeOut) {
                    const timeInDate = new Date(`1970-01-01T${timeIn}`);
                    const timeOutDate = new Date(`1970-01-01T${timeOut}`);
                    const diffMs = timeOutDate - timeInDate;
                    const diffHours = diffMs / (1000 * 60 * 60);
                    hoursWorked = diffHours.toFixed(2);
                }
            }
            
            detailedAttendance.push({
                userId: employee.userId,
                firstName: employee.firstName,
                lastName: employee.lastName,
                timeIn: timeIn || 'N/A',
                timeOut: timeOut || 'N/A',
                status: status,
                hoursWorked: hoursWorked,
                lateMinutes: lateMinutes,
                earlyOutMinutes: earlyOutMinutes,
                onLeave: !!empLeave,
                leaveRemarks: empLeave ? `${empLeave.leave_types?.typeName} - ${empLeave.reason}` : null
            });
        });
        
        const summary = {
            totalEmployees,
            present,
            onLeave,
            late,
            earlyOut
        };
        
        // Department breakdown (single department)
        const departmentBreakdown = [{
            department: departmentName,
            totalEmployees: totalEmployees,
            present: present,
            late: late,
            onLeave: onLeave,
            earlyOut: earlyOut
        }];
        
        // Format for display (group under department name)
        const detailedAttendanceByDept = {};
        detailedAttendanceByDept[departmentName] = detailedAttendance;
        
        const response = {
            success: true,
            reportDate: attendanceDate,
            department: departmentName,
            summary: summary,
            departmentBreakdown: departmentBreakdown,
            detailedAttendance: detailedAttendanceByDept
        };
        
        console.log(`✅ [Line Manager] Department attendance report generated for ${departmentName}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ [Line Manager] Error generating department attendance report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate department attendance report: ' + error.message
        });
    }
},

// Department employee attendance report (reuses HR logic with department verification)
getDepartmentEmployeeAttendanceReport: async (req, res) => {
    try {
        const { employeeId, startDate, endDate, reportType } = req.query;
        const managerId = req.session.user?.userId;
        
        console.log(`🔄 [Line Manager] Generating employee report for ${employeeId} from ${startDate} to ${endDate}`);
        
        if (!employeeId || !startDate || !endDate || !managerId) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID, date range, and manager authentication are required'
            });
        }
        
        // Verify the employee is in the manager's department
        const { data: managerInfo, error: managerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', managerId)
            .single();
        
        if (managerError || !managerInfo) {
            return res.status(500).json({
                success: false,
                message: 'Failed to verify manager department'
            });
        }
        
        const { data: employeeInfo, error: employeeError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId, 
                firstName, 
                lastName,
                hireDate,
                departments (
                    deptName
                ),
                jobpositions (
                    jobTitle
                )
            `)
            .eq('userId', employeeId)
            .single();
        
        if (employeeError || !employeeInfo) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }
        
        // Check if employee is in the same department as manager
        if (employeeInfo.departmentId !== managerInfo.departmentId) {
            return res.status(403).json({
                success: false,
                message: 'You can only view reports for employees in your department'
            });
        }
        
        // Get user account email
        const { data: userAccount, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', employeeId)
            .single();
        
        // Get attendance records for the date range
        const { data: attendanceRecords, error: attendanceError } = await supabase
            .from('attendance')
            .select(`
                attendanceDate,
                attendanceTime,
                attendanceAction,
                city
            `)
            .eq('userId', employeeId)
            .gte('attendanceDate', startDate)
            .lte('attendanceDate', endDate)
            .order('attendanceDate', { ascending: true })
            .order('attendanceTime', { ascending: true });
        
        if (attendanceError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch attendance records: ' + attendanceError.message
            });
        }
        
        // Get leave requests for the date range
        const { data: leaveRecords, error: leaveError } = await supabase
            .from('leaverequests')
            .select(`
                leaveRequestId,
                fromDate,
                untilDate,
                reason,
                status,
                created_at,
                updatedDate,
                remarkByManager,
                leave_types (
                    typeName
                )
            `)
            .eq('userId', employeeId)
            .or(`and(fromDate.lte.${endDate},untilDate.gte.${startDate})`)
            .order('fromDate', { ascending: false });
        
        if (leaveError) {
            console.error('❌ [Line Manager] Error fetching leave records:', leaveError);
        }
        
        // Get current leave balances
        const { data: leaveBalances, error: balanceError } = await supabase
            .from('leavebalances')
            .select(`
                totalLeaves,
                usedLeaves,
                remainingLeaves,
                leave_types (
                    typeName
                )
            `)
            .eq('userId', employeeId);
        
        if (balanceError) {
            console.error('❌ [Line Manager] Error fetching leave balances:', balanceError);
        }
        
        // Helper function to calculate working days in period (excluding weekends)
        const calculateWorkingDays = (start, end) => {
            let workingDays = 0;
            const currentDate = new Date(start);
            const endDate = new Date(end);
            
            while (currentDate <= endDate) {
                const dayOfWeek = currentDate.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Exclude Sunday (0) and Saturday (6)
                    workingDays++;
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            return workingDays;
        };
        
        // Helper function to check if date is on leave
        const isDateOnLeave = (date, leaveRecords) => {
            const checkDate = new Date(date);
            return leaveRecords.find(leave => {
                if (leave.status !== 'Approved') return false;
                const fromDate = new Date(leave.fromDate);
                const untilDate = new Date(leave.untilDate);
                return checkDate >= fromDate && checkDate <= untilDate;
            });
        };
        
        // Process attendance data by date
        const attendanceByDate = {};
        attendanceRecords.forEach(record => {
            if (!attendanceByDate[record.attendanceDate]) {
                attendanceByDate[record.attendanceDate] = [];
            }
            attendanceByDate[record.attendanceDate].push(record);
        });
        
        // Generate detailed attendance record for each working day
        const detailedAttendanceRecord = [];
        const workingDaysInPeriod = calculateWorkingDays(startDate, endDate);
        let daysPresent = 0;
        let daysOnLeave = 0;
        let lateArrivals = 0;
        let earlyOuts = 0;
        let totalWorkHours = 0;
        
        const currentDate = new Date(startDate);
        const endDateObj = new Date(endDate);
        
        while (currentDate <= endDateObj) {
            const dayOfWeek = currentDate.getDay();
            
            // Only process working days (Monday to Friday)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const dateString = currentDate.toISOString().split('T')[0];
                const dailyAttendance = attendanceByDate[dateString] || [];
                const leaveRecord = isDateOnLeave(dateString, leaveRecords || []);
                
                let timeIn = 'N/A';
                let timeOut = 'N/A';
                let hoursWorked = 'N/A';
                let status = 'Absent';
                let lateMinutes = 0;
                let earlyOutMinutes = 0;
                let onLeave = false;
                let leaveRemarks = 'N/A';
                
                if (leaveRecord) {
                    // Employee is on leave
                    status = 'On Leave';
                    onLeave = true;
                    leaveRemarks = `${leaveRecord.leave_types?.typeName || 'Leave'} - ${leaveRecord.reason || 'No reason provided'}`;
                    daysOnLeave++;
                } else if (dailyAttendance.length > 0) {
                    // Employee has attendance records
                    const timeInRecord = dailyAttendance.find(a => a.attendanceAction === 'Time In');
                    const timeOutRecord = dailyAttendance.find(a => a.attendanceAction === 'Time Out');
                    
                    if (timeInRecord) {
                        timeIn = timeInRecord.attendanceTime;
                        status = 'Present';
                        daysPresent++;
                        
                        // Check if late (standard time: 9:00 AM)
                        const standardTimeIn = '09:00:00';
                        if (timeIn > standardTimeIn) {
                            status = 'Late';
                            const timeInDate = new Date(`1970-01-01T${timeIn}`);
                            const standardDate = new Date(`1970-01-01T${standardTimeIn}`);
                            lateMinutes = Math.round((timeInDate - standardDate) / 60000);
                            lateArrivals++;
                        }
                    }
                    
                    if (timeOutRecord) {
                        timeOut = timeOutRecord.attendanceTime;
                        
                        // Check if early out (standard time: 6:00 PM)
                        const standardTimeOut = '18:00:00';
                        if (timeOut < standardTimeOut) {
                            const timeOutDate = new Date(`1970-01-01T${timeOut}`);
                            const standardDate = new Date(`1970-01-01T${standardTimeOut}`);
                            earlyOutMinutes = Math.round((standardDate - timeOutDate) / 60000);
                            earlyOuts++;
                        }
                    }
                    
                    // Calculate hours worked
                    if (timeIn !== 'N/A' && timeOut !== 'N/A') {
                        const timeInDate = new Date(`1970-01-01T${timeIn}`);
                        const timeOutDate = new Date(`1970-01-01T${timeOut}`);
                        const diffMs = timeOutDate - timeInDate;
                        const diffHours = diffMs / (1000 * 60 * 60);
                        hoursWorked = `${Math.floor(diffHours)} hrs ${Math.round((diffHours % 1) * 60)} mins`;
                        totalWorkHours += diffHours;
                    }
                }
                
                detailedAttendanceRecord.push({
                    date: currentDate.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }),
                    timeIn: timeIn,
                    timeOut: timeOut,
                    hoursWorked: hoursWorked,
                    status: status,
                    lateMinutes: lateMinutes,
                    earlyOutMinutes: earlyOutMinutes,
                    onLeave: onLeave,
                    leaveRemarks: leaveRemarks
                });
            }
            
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Format leave balances
        const formattedLeaveBalances = (leaveBalances || []).map(balance => ({
            leaveType: balance.leave_types?.typeName || 'Unknown',
            annualEntitlement: balance.totalLeaves || 0,
            used: balance.usedLeaves || 0,
            remaining: balance.remainingLeaves || 0
        }));
        
        // Separate approved and pending leave requests
        const approvedLeave = (leaveRecords || [])
            .filter(leave => leave.status === 'Approved')
            .map(leave => ({
                date: new Date(leave.fromDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }),
                leaveType: leave.leave_types?.typeName || 'Unknown',
                requestedDates: `${new Date(leave.fromDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                })} - ${new Date(leave.untilDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                })}`,
                duration: Math.ceil((new Date(leave.untilDate) - new Date(leave.fromDate)) / (1000 * 60 * 60 * 24)) + 1,
                status: leave.status,
                approvedBy: 'Manager',
                approvalDate: leave.updatedDate ? new Date(leave.updatedDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }) : 'N/A',
                remarks: leave.remarkByManager || 'N/A'
            }));
        
        const pendingLeave = (leaveRecords || [])
            .filter(leave => leave.status === 'Pending' || leave.status === 'Pending for Approval')
            .map(leave => ({
                date: new Date(leave.fromDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }),
                leaveType: leave.leave_types?.typeName || 'Unknown',
                requestedDates: `${new Date(leave.fromDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                })} - ${new Date(leave.untilDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                })}`,
                duration: Math.ceil((new Date(leave.untilDate) - new Date(leave.fromDate)) / (1000 * 60 * 60 * 24)) + 1,
                status: leave.status,
                decisionBy: 'Pending Manager Decision'
            }));
        
        // Build comprehensive response
        const response = {
            success: true,
            employee: {
                userId: employeeInfo.userId || employeeId,
                employeeName: `${employeeInfo.firstName} ${employeeInfo.lastName}`,
                firstName: employeeInfo.firstName,
                lastName: employeeInfo.lastName,
                position: employeeInfo.jobpositions?.jobTitle || 'Unknown',
                department: employeeInfo.departments?.deptName || 'Unknown',
                email: userAccount?.userEmail || 'N/A',
                hireDate: employeeInfo.hireDate
            },
            reportType: reportType,
            reportingPeriod: {
                startDate: startDate,
                endDate: endDate,
                periodType: reportType === 'weekly' ? 'Weekly' : 'Monthly'
            },
            reportGenerated: new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }),
            periodOverview: {
                workingDaysInPeriod: workingDaysInPeriod,
                daysPresent: daysPresent,
                daysOnLeave: daysOnLeave,
                lateArrivals: lateArrivals,
                earlyOuts: earlyOuts,
                totalWorkHours: `${Math.floor(totalWorkHours)} hrs ${Math.round((totalWorkHours % 1) * 60)} mins`
            },
            currentLeaveBalances: formattedLeaveBalances,
            detailedAttendanceRecord: detailedAttendanceRecord,
            leaveTaken: approvedLeave,
            pendingLeaveRequests: pendingLeave
        };
        
        console.log(`✅ [Line Manager] Employee attendance report generated for ${employeeInfo.firstName} ${employeeInfo.lastName}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ [Line Manager] Error generating employee report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate employee report: ' + error.message
        });
    }
},

// Department leave requests report
getDepartmentLeaveRequestsReport: async (req, res) => {
    try {
        const { startDate, endDate, reportType } = req.query;
        const managerId = req.session.user?.userId;
        
        console.log(`🔄 [Line Manager] Generating department leave report from ${startDate} to ${endDate}`);
        
        if (!startDate || !endDate || !managerId) {
            return res.status(400).json({
                success: false,
                message: 'Date range and manager authentication are required'
            });
        }
        
        // Get manager's department
        const { data: managerInfo, error: managerError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                departments (
                    deptName
                )
            `)
            .eq('userId', managerId)
            .single();
        
        if (managerError || !managerInfo) {
            return res.status(500).json({
                success: false,
                message: 'Failed to get manager department'
            });
        }
        
        const departmentId = managerInfo.departmentId;
        const departmentName = managerInfo.departments?.deptName || 'Unknown';
        
        // Get all department employees
        const { data: departmentEmployees, error: empError } = await supabase
            .from('staffaccounts')
            .select('userId')
            .eq('departmentId', departmentId);
        
        if (empError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch department employees'
            });
        }
        
        const departmentUserIds = departmentEmployees.map(emp => emp.userId);
        
        // Get leave requests for department employees in the date range
        const { data: leaveRequests, error: leaveError } = await supabase
            .from('leaverequests')
            .select(`
                leaveRequestId,
                fromDate,
                untilDate,
                reason,
                status,
                created_at,
                updatedDate,
                remarkByManager,
                userId,
                useraccounts!inner (
                    staffaccounts (
                        firstName,
                        lastName,
                        departments (
                            deptName
                        )
                    )
                ),
                leave_types (
                    typeName
                )
            `)
            .or(`and(fromDate.gte.${startDate},fromDate.lte.${endDate}),and(untilDate.gte.${startDate},untilDate.lte.${endDate}),and(fromDate.lte.${startDate},untilDate.gte.${endDate})`)
            .in('userId', departmentUserIds)
            .order('fromDate', { ascending: false });
        
        if (leaveError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch leave requests: ' + leaveError.message
            });
        }
        
        // Get leave balances for department employees
        const { data: leaveBalances, error: balanceError } = await supabase
            .from('leavebalances')
            .select(`
                userId,
                totalLeaves,
                usedLeaves,
                remainingLeaves,
                leaveTypeId,
                leave_types (
                    typeName
                )
            `)
            .in('userId', departmentUserIds);
        
        if (balanceError) {
            console.error('❌ [Line Manager] Error fetching leave balances:', balanceError);
        }
        
        // Format the data (similar to HR but department-specific)
        const formattedLeaveRequests = leaveRequests.map(leave => {
            const duration = Math.ceil((new Date(leave.untilDate) - new Date(leave.fromDate)) / (1000 * 60 * 60 * 24)) + 1;
            
            return {
                leaveRequestId: leave.leaveRequestId,
                userId: leave.userId,
                firstName: leave.useraccounts?.staffaccounts?.[0]?.firstName || 'Unknown',
                lastName: leave.useraccounts?.staffaccounts?.[0]?.lastName || 'Unknown',
                department: departmentName, // All from same department
                fromDate: leave.fromDate,
                untilDate: leave.untilDate,
                leaveType: leave.leave_types?.typeName || 'Unknown',
                reason: leave.reason || 'No reason provided',
                status: leave.status || 'Pending',
                createdAt: leave.created_at,
                updatedDate: leave.updatedDate,
                remarkByManager: leave.remarkByManager || '',
                duration: duration
            };
        });
        
        // Calculate statistics
        const statistics = {
            totalRequests: formattedLeaveRequests.length,
            approvedRequests: formattedLeaveRequests.filter(req => req.status === 'Approved').length,
            pendingRequests: formattedLeaveRequests.filter(req => req.status === 'Pending' || req.status === 'Pending for Approval').length,
            rejectedRequests: formattedLeaveRequests.filter(req => req.status === 'Rejected').length,
            totalDaysRequested: formattedLeaveRequests.reduce((sum, req) => sum + req.duration, 0),
            totalDaysApproved: formattedLeaveRequests
                .filter(req => req.status === 'Approved')
                .reduce((sum, req) => sum + req.duration, 0)
        };
        
        // Format leave balances
        const formattedLeaveBalances = (leaveBalances || []).map(balance => {
            const userRequest = formattedLeaveRequests.find(req => req.userId === balance.userId);
            return {
                userId: balance.userId,
                firstName: userRequest?.firstName || 'Unknown',
                lastName: userRequest?.lastName || 'Unknown',
                department: departmentName,
                leaveType: balance.leave_types?.typeName || 'Unknown',
                totalLeaves: balance.totalLeaves || 0,
                usedLeaves: balance.usedLeaves || 0,
                remainingLeaves: balance.remainingLeaves || 0,
                leaveTypeId: balance.leaveTypeId
            };
        });
        
        const response = {
            success: true,
            reportType: reportType || 'monthly',
            startDate: startDate,
            endDate: endDate,
            department: departmentName,
            generatedAt: new Date().toISOString(),
            statistics: statistics,
            leaveRequests: formattedLeaveRequests,
            leaveBalances: formattedLeaveBalances,
            departmentBreakdown: [{
                department: departmentName,
                totalRequests: statistics.totalRequests,
                approvedRequests: statistics.approvedRequests,
                pendingRequests: statistics.pendingRequests,
                rejectedRequests: statistics.rejectedRequests,
                totalDaysRequested: statistics.totalDaysRequested,
                totalDaysApproved: statistics.totalDaysApproved,
                requests: formattedLeaveRequests
            }]
        };
        
        console.log(`✅ [Line Manager] Department leave report generated for ${departmentName}`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ [Line Manager] Error generating department leave report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate department leave report: ' + error.message
        });
    }
},

// ============================
// 360 FEEDBACK REPORTS MODULE - BACKEND CONTROLLER FUNCTIONS (FIXED)
// ============================

// Main dashboard for 360 feedback reports
getQuarterlyFeedbackReportsDashboard: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        try {
            console.log('🔄 [Line Manager] Loading quarterly feedback reports dashboard...');
            console.log('👤 User session:', {
                userId: req.session.user.userId,
                userRole: req.session.user.userRole
            });
            
            const lineManagerId = req.session.user.userId;
            console.log('🔍 Line Manager ID:', lineManagerId);
            
            // Get the line manager's department ID
            const { data: lineManagerData, error: lineManagerError } = await supabase
                .from('staffaccounts')
                .select(`
                    departmentId,
                    departments(deptName)
                `)
                .eq('userId', lineManagerId)
                .single();

            console.log('🏢 Line Manager Query Result:', lineManagerData);
            console.log('❌ Line Manager Query Error:', lineManagerError);

            if (lineManagerError) {
                console.error('Error fetching line manager department:', lineManagerError);
                req.flash('errors', { dbError: 'Error fetching line manager information.' });
                return res.redirect('/linemanager/dashboard');
            }

            if (!lineManagerData) {
                console.error('No line manager data found');
                req.flash('errors', { authError: 'Line manager account not found.' });
                return res.redirect('/linemanager/dashboard');
            }

            const lineManagerDepartmentId = lineManagerData?.departmentId;
            const departmentName = lineManagerData?.departments?.deptName;
            
            console.log('🏢 Department ID:', lineManagerDepartmentId);
            console.log('🏢 Department Name:', departmentName);

            if (!lineManagerDepartmentId) {
                req.flash('errors', { authError: 'Department not assigned to your account. Please contact HR.' });
                return res.redirect('/linemanager/dashboard');
            }

            // Add debugging verification
            await lineManagerController.verifyDatabaseData(lineManagerDepartmentId);

            // Get department statistics
            const stats = await lineManagerController.getDepartmentFeedbackStats(lineManagerDepartmentId);
            console.log('📈 Stats result:', stats);
            
            // Get available years with feedback data
            const availableYears = await lineManagerController.getAvailableReportYears(lineManagerDepartmentId);
            console.log('📅 Available years:', availableYears);
            
            // Get available quarters for current year
            const currentYear = new Date().getFullYear();
            const availableQuarters = await lineManagerController.getAvailableQuarters(lineManagerDepartmentId, currentYear);
            console.log('📋 Available quarters:', availableQuarters);

            res.render('staffpages/linemanager_pages/records-performance-tracker', {
                user: req.session.user,
                departmentName: departmentName,
                departmentId: lineManagerDepartmentId,
                stats: stats,
                availableYears: availableYears,
                availableQuarters: availableQuarters,
                currentYear: currentYear,
                employees: [] // Add empty employees array for the original records tab
            });

        } catch (error) {
            console.error('❌ Error loading feedback reports dashboard:', error);
            req.flash('errors', { dbError: 'Error loading feedback reports dashboard: ' + error.message });
            res.redirect('/linemanager/dashboard');
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
        res.redirect('/staff/login');
    }
},

// Get department employees for reports dropdown
getDepartmentEmployeesForFeedbackReports: async function(req, res) {
    try {
        console.log('🔄 [Line Manager] Fetching department employees for feedback reports...');
        
        const lineManagerId = req.session.user?.userId;
        if (!lineManagerId) {
            console.error('❌ Line Manager not authenticated');
            return res.status(401).json({
                success: false,
                message: 'Line Manager not authenticated'
            });
        }

        console.log('👤 Line Manager ID:', lineManagerId);

        // Get the line manager's department
        const { data: lineManagerData, error: lineManagerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerId)
            .single();

        console.log('🏢 Line Manager Department Query:', lineManagerData);
        if (lineManagerError) console.log('❌ Line Manager Department Error:', lineManagerError);

        if (lineManagerError || !lineManagerData) {
            return res.status(500).json({
                success: false,
                message: 'Failed to get line manager department information: ' + (lineManagerError?.message || 'No data')
            });
        }

        const departmentId = lineManagerData.departmentId;
        console.log('🏢 Department ID:', departmentId);

        // Get all employees in the department (excluding the line manager)
        const { data: employees, error: employeeError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                hireDate,
                jobpositions!staffaccounts_jobId_fkey(jobTitle),
                departments!staffaccounts_departmentId_fkey(deptName)
            `)
            .eq('departmentId', departmentId)
            .neq('userId', lineManagerId)
            .order('firstName', { ascending: true });

        console.log('👥 Employee Query Result:', employees?.length || 0);
        if (employeeError) console.log('❌ Employee Query Error:', employeeError);

        if (employeeError) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch department employees: ' + employeeError.message
            });
        }

        // Check which employees have feedback data for each quarter
        const enrichedEmployees = [];
        
        for (const employee of employees || []) {
            console.log(`🔍 Checking feedback availability for: ${employee.firstName} ${employee.lastName} (ID: ${employee.userId})`);
            
            // FIXED: Call the function directly instead of using 'this'
            const feedbackAvailability = await lineManagerController.checkEmployeeFeedbackAvailability(employee.userId);
            
            enrichedEmployees.push({
                userId: employee.userId,
                firstName: employee.firstName,
                lastName: employee.lastName,
                fullName: `${employee.firstName} ${employee.lastName}`,
                jobTitle: employee.jobpositions?.jobTitle || 'Unknown',
                department: employee.departments?.deptName || 'Unknown',
                hireDate: employee.hireDate,
                feedbackAvailability: feedbackAvailability
            });
        }

        console.log('✅ Enriched employees:', enrichedEmployees.length);

        return res.json({
            success: true,
            employees: enrichedEmployees,
            departmentId: departmentId
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error fetching department employees:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch department employees: ' + error.message
        });
    }
},

// Generate quarterly feedback report (view or PDF)
generateQuarterlyFeedbackReport: async function(req, res) {
    try {
        console.log('🔄 [Line Manager] Generating quarterly feedback report...');
        
        const { employeeId, quarter, year, format } = req.query;
        const lineManagerId = req.session.user?.userId;

        // Validate required parameters
        if (!employeeId || !quarter || !year) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID, quarter, and year are required'
            });
        }

        // Verify employee is in line manager's department
        const isAuthorized = await lineManagerController.verifyEmployeeInDepartment(lineManagerId, employeeId);
        if (!isAuthorized) {
            return res.status(403).json({
                success: false,
                message: 'You can only generate reports for employees in your department'
            });
        }

        // Get employee information
        const employeeInfo = await lineManagerController.getEmployeeBasicInfo(employeeId);
        if (!employeeInfo.success) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get line manager information
        const lineManagerInfo = await lineManagerController.getEmployeeBasicInfo(lineManagerId);

        // Get feedback data for the specified quarter
        const feedbackData = await lineManagerController.getQuarterlyFeedbackData(employeeId, quarter, year);
        if (!feedbackData.success) {
            return res.status(404).json({
                success: false,
                message: 'No feedback data found for the specified period'
            });
        }

        // Prepare the complete report data
        const reportData = {
            employee: employeeInfo.data,
            lineManager: lineManagerInfo.data,
            reportingPeriod: {
                quarter: quarter,
                year: parseInt(year),
                startDate: feedbackData.data.startDate,
                endDate: feedbackData.data.endDate
            },
            objectives: feedbackData.data.objectives,
            hardSkills: feedbackData.data.hardSkills,
            softSkills: feedbackData.data.softSkills,
            summary: feedbackData.data.summary,
            generatedDate: new Date().toISOString(),
            generatedBy: `${lineManagerInfo.data.firstName} ${lineManagerInfo.data.lastName}`
        };

        if (format === 'pdf') {
            // Return data for PDF generation on frontend
            return res.json({
                success: true,
                data: reportData,
                generatePDF: true,
                filename: `360_Feedback_Report_${employeeInfo.data.firstName}_${employeeInfo.data.lastName}_${quarter}_${year}.pdf`
            });
        } else {
            // Return JSON data for view
            return res.json({
                success: true,
                data: reportData
            });
        }

    } catch (error) {
        console.error('❌ [Line Manager] Error generating feedback report:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate feedback report: ' + error.message
        });
    }
},

// Generate mid-year feedback report (Q1 + Q2)
generateMidYearFeedbackReport: async function(req, res) {
    try {
        console.log('🔄 [Line Manager] Generating mid-year feedback report...');
        
        const { employeeId, year, format } = req.query;
        const lineManagerId = req.session.user?.userId;

        // Validate required parameters
        if (!employeeId || !year) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID and year are required'
            });
        }

        // Verify employee is in line manager's department
        const isAuthorized = await lineManagerController.verifyEmployeeInDepartment(lineManagerId, employeeId);
        if (!isAuthorized) {
            return res.status(403).json({
                success: false,
                message: 'You can only generate reports for employees in your department'
            });
        }

        // Get combined Q1 + Q2 data
        const midYearData = await lineManagerController.getCombinedQuarterData(employeeId, ['Q1', 'Q2'], year);
        
        if (!midYearData.success) {
            return res.status(404).json({
                success: false,
                message: 'Insufficient feedback data for mid-year report'
            });
        }

        // Get employee and line manager info
        const employeeInfo = await lineManagerController.getEmployeeBasicInfo(employeeId);
        const lineManagerInfo = await lineManagerController.getEmployeeBasicInfo(lineManagerId);

        const reportData = {
            employee: employeeInfo.data,
            lineManager: lineManagerInfo.data,
            reportingPeriod: {
                type: 'mid-year',
                year: parseInt(year),
                quarters: ['Q1', 'Q2'],
                q1Period: midYearData.data.q1Period,
                q2Period: midYearData.data.q2Period
            },
            objectives: midYearData.data.objectives,
            hardSkills: midYearData.data.hardSkills,
            softSkills: midYearData.data.softSkills,
            summary: midYearData.data.summary,
            generatedDate: new Date().toISOString(),
            generatedBy: `${lineManagerInfo.data.firstName} ${lineManagerInfo.data.lastName}`
        };

        if (format === 'pdf') {
            return res.json({
                success: true,
                data: reportData,
                generatePDF: true,
                filename: `Mid_Year_360_Report_${employeeInfo.data.firstName}_${employeeInfo.data.lastName}_${year}.pdf`
            });
        } else {
            return res.json({
                success: true,
                data: reportData
            });
        }

    } catch (error) {
        console.error('❌ [Line Manager] Error generating mid-year report:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate mid-year report: ' + error.message
        });
    }
},

// Generate final-year feedback report (Q3 + Q4)
generateFinalYearFeedbackReport: async function(req, res) {
    try {
        console.log('🔄 [Line Manager] Generating final-year feedback report...');
        
        const { employeeId, year, format } = req.query;
        const lineManagerId = req.session.user?.userId;

        if (!employeeId || !year) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID and year are required'
            });
        }

        const isAuthorized = await lineManagerController.verifyEmployeeInDepartment(lineManagerId, employeeId);
        if (!isAuthorized) {
            return res.status(403).json({
                success: false,
                message: 'You can only generate reports for employees in your department'
            });
        }

        // Get combined Q3 + Q4 data
        const finalYearData = await lineManagerController.getCombinedQuarterData(employeeId, ['Q3', 'Q4'], year);
        
        if (!finalYearData.success) {
            return res.status(404).json({
                success: false,
                message: 'Insufficient feedback data for final-year report'
            });
        }

        const employeeInfo = await lineManagerController.getEmployeeBasicInfo(employeeId);
        const lineManagerInfo = await lineManagerController.getEmployeeBasicInfo(lineManagerId);

        const reportData = {
            employee: employeeInfo.data,
            lineManager: lineManagerInfo.data,
            reportingPeriod: {
                type: 'final-year',
                year: parseInt(year),
                quarters: ['Q3', 'Q4'],
                q3Period: finalYearData.data.q3Period,
                q4Period: finalYearData.data.q4Period
            },
            objectives: finalYearData.data.objectives,
            hardSkills: finalYearData.data.hardSkills,
            softSkills: finalYearData.data.softSkills,
            summary: finalYearData.data.summary,
            generatedDate: new Date().toISOString(),
            generatedBy: `${lineManagerInfo.data.firstName} ${lineManagerInfo.data.lastName}`
        };

        if (format === 'pdf') {
            return res.json({
                success: true,
                data: reportData,
                generatePDF: true,
                filename: `Final_Year_360_Report_${employeeInfo.data.firstName}_${employeeInfo.data.lastName}_${year}.pdf`
            });
        } else {
            return res.json({
                success: true,
                data: reportData
            });
        }

    } catch (error) {
        console.error('❌ [Line Manager] Error generating final-year report:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate final-year report: ' + error.message
        });
    }
},

// Helper function: Get department feedback statistics
getDepartmentFeedbackStats: async function(departmentId) {
    try {
        console.log('📊 Getting department feedback stats for department:', departmentId);
        
        // Get all employees in department
        const { data: employees, error: empError } = await supabase
            .from('staffaccounts')
            .select('userId')
            .eq('departmentId', departmentId);

        if (empError) {
            console.error('Error fetching department employees:', empError);
            return { totalEmployees: 0, employeesWithFeedback: 0, completedQuarters: [] };
        }

        console.log('📊 Found employees in department:', employees?.length || 0);
        
        const employeeIds = employees?.map(emp => emp.userId) || [];
        const currentYear = new Date().getFullYear();
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        
        let totalEmployeesWithFeedback = new Set(); // Use Set to avoid duplicates
        const completedQuarters = [];

        // Check each quarter for feedback completion
        for (const quarter of quarters) {
            const feedbackTable = `feedbacks_${quarter}`;
            
            try {
                console.log(`🔍 Checking table: ${feedbackTable} for year: ${currentYear}`);
                
                const { data: quarterFeedback, error: quarterError } = await supabase
                    .from(feedbackTable)
                    .select('userId')
                    .in('userId', employeeIds)
                    .eq('quarter', quarter)
                    .eq('year', currentYear);

                if (quarterError) {
                    console.log(`⚠️ Error checking ${feedbackTable}:`, quarterError.message);
                    continue;
                }

                if (quarterFeedback && quarterFeedback.length > 0) {
                    console.log(`✅ Found ${quarterFeedback.length} feedback records in ${quarter}`);
                    
                    completedQuarters.push({
                        quarter: quarter,
                        employeeCount: quarterFeedback.length
                    });
                    
                    // Add unique employee IDs to our set
                    quarterFeedback.forEach(fb => totalEmployeesWithFeedback.add(fb.userId));
                } else {
                    console.log(`📝 No feedback found for ${quarter} ${currentYear}`);
                }
            } catch (tableError) {
                console.log(`❌ Table ${feedbackTable} might not exist:`, tableError.message);
            }
        }

        const stats = {
            totalEmployees: employees?.length || 0,
            employeesWithFeedback: totalEmployeesWithFeedback.size,
            completedQuarters: completedQuarters,
            currentYear: currentYear
        };
        
        console.log('📈 Final stats:', stats);
        return stats;

    } catch (error) {
        console.error('❌ Error getting department feedback stats:', error);
        return { totalEmployees: 0, employeesWithFeedback: 0, completedQuarters: [] };
    }
},

// Helper function: Get available report years
getAvailableReportYears: async function(departmentId) {
    try {
        const { data: employees, error: empError } = await supabase
            .from('staffaccounts')
            .select('userId')
            .eq('departmentId', departmentId);

        if (empError) return [new Date().getFullYear()];

        const employeeIds = employees?.map(emp => emp.userId) || [];
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const yearsSet = new Set();

        for (const quarter of quarters) {
            try {
                const { data: yearData, error: yearError } = await supabase
                    .from(`feedbacks_${quarter}`)
                    .select('year')
                    .in('userId', employeeIds);

                if (!yearError && yearData) {
                    yearData.forEach(item => yearsSet.add(item.year));
                }
            } catch (tableError) {
                // Table might not exist, continue
            }
        }

        const years = Array.from(yearsSet).sort((a, b) => b - a);
        return years.length > 0 ? years : [new Date().getFullYear()];

    } catch (error) {
        console.error('Error getting available years:', error);
        return [new Date().getFullYear()];
    }
},

// Helper function: Get available quarters for a year
getAvailableQuarters: async function(departmentId, year) {
    try {
        const { data: employees, error: empError } = await supabase
            .from('staffaccounts')
            .select('userId')
            .eq('departmentId', departmentId);

        if (empError) return [];

        const employeeIds = employees?.map(emp => emp.userId) || [];
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const availableQuarters = [];

        for (const quarter of quarters) {
            try {
                const { data: quarterData, error: quarterError } = await supabase
                    .from(`feedbacks_${quarter}`)
                    .select('quarter')
                    .in('userId', employeeIds)
                    .eq('year', year)
                    .limit(1);

                if (!quarterError && quarterData && quarterData.length > 0) {
                    availableQuarters.push(quarter);
                }
            } catch (tableError) {
                // Table might not exist
            }
        }

        return availableQuarters;

    } catch (error) {
        console.error('Error getting available quarters:', error);
        return [];
    }
},

// Helper function: Check employee feedback availability
checkEmployeeFeedbackAvailability: async function(userId) {
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const currentYear = new Date().getFullYear();
    const availability = {};

    console.log(`🔍 Checking feedback availability for user ${userId} in year ${currentYear}`);

    for (const quarter of quarters) {
        try {
            const feedbackTable = `feedbacks_${quarter}`;
            console.log(`🔍 Checking table: ${feedbackTable}`);
            
            const { data: feedbackData, error: feedbackError } = await supabase
                .from(feedbackTable)
                .select('quarter')
                .eq('userId', userId)
                .eq('quarter', quarter)
                .eq('year', currentYear)
                .limit(1);

            if (feedbackError) {
                console.log(`⚠️ Error checking ${feedbackTable}:`, feedbackError.message);
                availability[quarter] = false;
            } else {
                const hasData = feedbackData && feedbackData.length > 0;
                availability[quarter] = hasData;
                console.log(`📋 ${quarter}: ${hasData ? 'Available' : 'Not available'}`);
            }
        } catch (tableError) {
            console.log(`❌ Table ${feedbackTable} error:`, tableError.message);
            availability[quarter] = false;
        }
    }

    console.log(`✅ Final availability for user ${userId}:`, availability);
    return availability;
},

// Helper function: Verify employee is in line manager's department
verifyEmployeeInDepartment: async function(lineManagerId, employeeId) {
    try {
        const { data: lineManagerData, error: lmError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', lineManagerId)
            .single();

        const { data: employeeData, error: empError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', employeeId)
            .single();

        if (lmError || empError || !lineManagerData || !employeeData) {
            return false;
        }

        return lineManagerData.departmentId === employeeData.departmentId;

    } catch (error) {
        console.error('Error verifying employee in department:', error);
        return false;
    }
},

// Helper function: Check if table exists
checkTableExists: async function(tableName) {
    try {
        const { data, error } = await supabase
            .from(tableName)
            .select('*')
            .limit(1);
        
        if (error) {
            console.log(`❌ Table ${tableName} error:`, error.message);
            return false;
        }
        
        console.log(`✅ Table ${tableName} exists`);
        return true;
    } catch (error) {
        console.log(`❌ Table ${tableName} does not exist:`, error.message);
        return false;
    }
},

// Helper function: Verify database data
verifyDatabaseData: async function(departmentId) {
    console.log('🔍 DEBUGGING - Verifying database data for department:', departmentId);
    
    try {
        // Check if department exists
        const { data: dept, error: deptError } = await supabase
            .from('departments')
            .select('*')
            .eq('departmentId', departmentId);
        
        console.log('🏢 Department data:', dept?.length || 0, dept);
        if (deptError) console.log('🏢 Department error:', deptError);
        
        // Check employees in department
        const { data: emps, error: empError } = await supabase
            .from('staffaccounts')
            .select('userId, firstName, lastName, departmentId')
            .eq('departmentId', departmentId);
        
        console.log('👥 Employees in department:', emps?.length || 0);
        if (empError) console.log('👥 Employee error:', empError);
        
        // Check each feedback table
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        for (const quarter of quarters) {
            const tableName = `feedbacks_${quarter}`;
            const exists = await lineManagerController.checkTableExists(tableName);
            if (exists) {
                const { data: feedbacks, error } = await supabase
                    .from(tableName)
                    .select('*')
                    .limit(3);
                console.log(`📋 Sample data from ${tableName}:`, feedbacks?.length || 0);
                if (error) console.log(`📋 Error from ${tableName}:`, error);
            }
        }
    } catch (error) {
        console.error('❌ Error in verifyDatabaseData:', error);
    }
},

// Helper function: Get employee basic information
getEmployeeBasicInfo: async function(userId) {
    try {
        const { data: employee, error: empError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                hireDate,
                jobpositions(jobTitle),
                departments(deptName),
                useraccounts(userEmail)
            `)
            .eq('userId', userId)
            .single();

        if (empError || !employee) {
            return { success: false, message: 'Employee not found' };
        }

        return {
            success: true,
            data: {
                userId: employee.userId,
                firstName: employee.firstName,
                lastName: employee.lastName,
                fullName: `${employee.firstName} ${employee.lastName}`,
                jobTitle: employee.jobpositions?.jobTitle || 'Unknown',
                department: employee.departments?.deptName || 'Unknown',
                email: employee.useraccounts?.userEmail || 'N/A',
                hireDate: employee.hireDate
            }
        };

    } catch (error) {
        console.error('Error getting employee basic info:', error);
        return { success: false, message: 'Error fetching employee information' };
    }
},

// Helper function: Get quarterly feedback data for report
getQuarterlyFeedbackData: async function(userId, quarter, year) {
    try {
        console.log(`🔄 Fetching feedback data for user ${userId}, ${quarter} ${year}`);

        const feedbackTable = `feedbacks_${quarter}`;
        const feedbackIdField = `feedbackq${quarter.substring(1)}_Id`;

        // Get the feedback record
        const { data: feedbackRecord, error: feedbackError } = await supabase
            .from(feedbackTable)
            .select(`
                ${feedbackIdField},
                setStartDate,
                setEndDate,
                userId,
                jobId
            `)
            .eq('userId', userId)
            .eq('quarter', quarter)
            .eq('year', year)
            .single();

        if (feedbackError || !feedbackRecord) {
            return { success: false, message: 'No feedback record found' };
        }

        const feedbackId = feedbackRecord[feedbackIdField];

        // Get objectives data
        const objectivesData = await lineManagerController.getObjectivesReportData(feedbackId, feedbackIdField);
        
        // Get skills data
        const skillsData = await lineManagerController.getSkillsReportData(feedbackId, feedbackIdField, feedbackRecord.jobId);

        // Calculate summary statistics
        const summary = lineManagerController.calculateFeedbackSummary(objectivesData, skillsData);

        return {
            success: true,
            data: {
                startDate: feedbackRecord.setStartDate,
                endDate: feedbackRecord.setEndDate,
                objectives: objectivesData,
                hardSkills: skillsData.hardSkills,
                softSkills: skillsData.softSkills,
                summary: summary
            }
        };

    } catch (error) {
        console.error('Error getting quarterly feedback data:', error);
        return { success: false, message: 'Error fetching feedback data' };
    }
},

// Helper function: Get combined quarter data for mid-year/final-year reports
getCombinedQuarterData: async function(userId, quarters, year) {
    try {
        console.log(`🔄 Fetching combined data for user ${userId}, quarters ${quarters.join(', ')}, year ${year}`);

        const quarterData = {};
        let allObjectives = [];
        let allHardSkills = [];
        let allSoftSkills = [];

        // Get data for each quarter
        for (const quarter of quarters) {
            const singleQuarterData = await lineManagerController.getQuarterlyFeedbackData(userId, quarter, year);
            
            if (singleQuarterData.success) {
                quarterData[quarter.toLowerCase()] = {
                    startDate: singleQuarterData.data.startDate,
                    endDate: singleQuarterData.data.endDate,
                    objectives: singleQuarterData.data.objectives,
                    hardSkills: singleQuarterData.data.hardSkills,
                    softSkills: singleQuarterData.data.softSkills
                };
            }
        }

        // Check if we have data for both quarters
        if (Object.keys(quarterData).length < 2) {
            return { success: false, message: 'Insufficient data for both quarters' };
        }

        // Combine objectives data
        const objectivesMap = new Map();
        
        quarters.forEach(quarter => {
            const qData = quarterData[quarter.toLowerCase()];
            if (qData && qData.objectives) {
                qData.objectives.forEach(obj => {
                    const key = obj.objective;
                    if (!objectivesMap.has(key)) {
                        objectivesMap.set(key, {
                            objective: obj.objective,
                            kpi: obj.kpi,
                            target: obj.target,
                            uom: obj.uom,
                            assignedWeight: obj.assignedWeight,
                            quarterData: {}
                        });
                    }
                    objectivesMap.get(key).quarterData[quarter] = {
                        averageRating: parseFloat(obj.averageRating),
                        weightedScore: parseFloat(obj.weightedScore)
                    };
                });
            }
        });

        // Calculate combined averages for objectives
        objectivesMap.forEach((obj, key) => {
            const ratings = Object.values(obj.quarterData).map(q => q.averageRating).filter(r => r > 0);
            const weightedScores = Object.values(obj.quarterData).map(q => q.weightedScore).filter(s => s > 0);
            
            obj.combinedAverageRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
            obj.combinedWeightedScore = weightedScores.length > 0 ? (weightedScores.reduce((a, b) => a + b, 0) / weightedScores.length) : 0;
        });

        allObjectives = Array.from(objectivesMap.values());

        // Combine skills data (similar process for hard and soft skills)
        [allHardSkills, allSoftSkills] = lineManagerController.combineSkillsData(quarterData, quarters);

        // Calculate combined summary
        const combinedSummary = lineManagerController.calculateCombinedSummary(allObjectives, allHardSkills, allSoftSkills);

        return {
            success: true,
            data: {
                [`${quarters[0].toLowerCase()}Period`]: quarterData[quarters[0].toLowerCase()],
                [`${quarters[1].toLowerCase()}Period`]: quarterData[quarters[1].toLowerCase()],
                objectives: allObjectives,
                hardSkills: allHardSkills,
                softSkills: allSoftSkills,
                summary: combinedSummary
            }
        };

    } catch (error) {
        console.error('Error getting combined quarter data:', error);
        return { success: false, message: 'Error fetching combined quarter data' };
    }
},

// Helper function: Combine skills data from multiple quarters
combineSkillsData: function(quarterData, quarters) {
    const hardSkillsMap = new Map();
    const softSkillsMap = new Map();

    quarters.forEach(quarter => {
        const qData = quarterData[quarter.toLowerCase()];
        if (qData) {
            // Process hard skills
            if (qData.hardSkills) {
                qData.hardSkills.forEach(skill => {
                    const key = skill.skillName;
                    if (!hardSkillsMap.has(key)) {
                        hardSkillsMap.set(key, {
                            skillName: skill.skillName,
                            quarterData: {}
                        });
                    }
                    hardSkillsMap.get(key).quarterData[quarter] = {
                        averageRating: parseFloat(skill.averageRating)
                    };
                });
            }

            // Process soft skills
            if (qData.softSkills) {
                qData.softSkills.forEach(skill => {
                    const key = skill.skillName;
                    if (!softSkillsMap.has(key)) {
                        softSkillsMap.set(key, {
                            skillName: skill.skillName,
                            quarterData: {}
                        });
                    }
                    softSkillsMap.get(key).quarterData[quarter] = {
                        averageRating: parseFloat(skill.averageRating)
                    };
                });
            }
        }
    });

    // Calculate combined averages
    hardSkillsMap.forEach((skill, key) => {
        const ratings = Object.values(skill.quarterData).map(q => q.averageRating).filter(r => r > 0);
        skill.combinedAverageRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    });

    softSkillsMap.forEach((skill, key) => {
        const ratings = Object.values(skill.quarterData).map(q => q.averageRating).filter(r => r > 0);
        skill.combinedAverageRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;
    });

    return [Array.from(hardSkillsMap.values()), Array.from(softSkillsMap.values())];
},

// Helper function: Calculate combined summary statistics
calculateCombinedSummary: function(objectives, hardSkills, softSkills) {
    const objectiveRatings = objectives.map(obj => obj.combinedAverageRating).filter(r => r > 0);
    const hardSkillRatings = hardSkills.map(skill => skill.combinedAverageRating).filter(r => r > 0);
    const softSkillRatings = softSkills.map(skill => skill.combinedAverageRating).filter(r => r > 0);

    const totalWeightedScore = objectives.reduce((sum, obj) => sum + obj.combinedWeightedScore, 0);
    const totalWeight = objectives.reduce((sum, obj) => sum + obj.assignedWeight, 0);

    return {
        objectivesCount: objectives.length,
        hardSkillsCount: hardSkills.length,
        softSkillsCount: softSkills.length,
        averageObjectiveRating: objectiveRatings.length > 0 
            ? (objectiveRatings.reduce((a, b) => a + b, 0) / objectiveRatings.length).toFixed(1)
            : '0.0',
        averageHardSkillRating: hardSkillRatings.length > 0 
            ? (hardSkillRatings.reduce((a, b) => a + b, 0) / hardSkillRatings.length).toFixed(1)
            : '0.0',
        averageSoftSkillRating: softSkillRatings.length > 0 
            ? (softSkillRatings.reduce((a, b) => a + b, 0) / softSkillRatings.length).toFixed(1)
            : '0.0',
        totalWeightedScore: totalWeightedScore.toFixed(2),
        totalWeight: totalWeight,
        overallPerformanceScore: totalWeight > 0 ? (totalWeightedScore / totalWeight).toFixed(1) : '0.0'
    };
},

// Helper function: Get objectives report data
getObjectivesReportData: async function(feedbackId, feedbackIdField) {
    try {
        // Get objective questions
        const { data: objectiveQuestions, error: objQError } = await supabase
            .from('feedbacks_questions-objectives')
            .select(`
                feedback_qObjectivesId,
                objectiveId,
                objectiveQualiQuestion,
                ${feedbackIdField}
            `)
            .eq(feedbackIdField, feedbackId);

        if (objQError || !objectiveQuestions) {
            return [];
        }

        const objectivesReport = [];

        for (const objQuestion of objectiveQuestions) {
            // Get objective details
            const { data: objectiveDetail, error: objDetailError } = await supabase
                .from('objectivesettings_objectives')
                .select('*')
                .eq('objectiveId', objQuestion.objectiveId)
                .single();

            // Get all answers for this objective
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-objectives')
                .select('objectiveQuantInput, objectiveQualInput')
                .eq('feedback_qObjectivesId', objQuestion.feedback_qObjectivesId);

            if (!answersError && answers && answers.length > 0) {
                // Calculate average rating
                const validRatings = answers.filter(a => a.objectiveQuantInput).map(a => a.objectiveQuantInput);
                const averageRating = validRatings.length > 0 
                    ? (validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length) 
                    : 0;

                // Calculate weighted score
                const weight = objectiveDetail?.objectiveAssignedWeight || 0;
                const weightedScore = (averageRating * weight);

                // Combine qualitative feedback
                const qualitativeFeedback = answers
                    .map(a => a.objectiveQualInput)
                    .filter(feedback => feedback && feedback.trim())
                    .join('; ');

                objectivesReport.push({
                    objective: objectiveDetail?.objectiveDescrpt || 'Unknown Objective',
                    kpi: objectiveDetail?.objectiveKPI || 'N/A',
                    target: objectiveDetail?.objectiveTarget || 'N/A',
                    uom: objectiveDetail?.objectiveUOM || 'N/A',
                    assignedWeight: weight,
                    weightedScore: weightedScore.toFixed(2),
                    averageRating: averageRating.toFixed(1),
                    qualitativeFeedback: qualitativeFeedback || 'No feedback provided',
                    responseCount: validRatings.length
                });
            }
        }

        return objectivesReport;

    } catch (error) {
        console.error('Error getting objectives report data:', error);
        return [];
    }
},

// Helper function: Get skills report data
getSkillsReportData: async function(feedbackId, feedbackIdField, jobId) {
    try {
        // Get all job skills
        const { data: jobSkills, error: skillsError } = await supabase
            .from('jobreqskills')
            .select('*')
            .eq('jobId', jobId);

        if (skillsError || !jobSkills) {
            return { hardSkills: [], softSkills: [] };
        }

        // Get skill questions
        const { data: skillQuestions, error: skillQError } = await supabase
            .from('feedbacks_questions-skills')
            .select(`
                feedback_qSkillsId,
                jobReqSkillId,
                ${feedbackIdField}
            `)
            .eq(feedbackIdField, feedbackId);

        if (skillQError || !skillQuestions) {
            return { hardSkills: [], softSkills: [] };
        }

        const hardSkills = [];
        const softSkills = [];

        for (const skillQuestion of skillQuestions) {
            // Find the skill details
            const skill = jobSkills.find(s => s.jobReqSkillId === skillQuestion.jobReqSkillId);
            if (!skill) continue;

            // Get answers for this skill
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-skills')
                .select('skillsQuantInput, skillsQualInput')
                .eq('feedback_qSkillsId', skillQuestion.feedback_qSkillsId);

            if (!answersError && answers && answers.length > 0) {
                // Calculate average rating
                const validRatings = answers.filter(a => a.skillsQuantInput).map(a => a.skillsQuantInput);
                const averageRating = validRatings.length > 0 
                    ? (validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length) 
                    : 0;

                // Combine qualitative feedback
                const qualitativeFeedback = answers
                    .map(a => a.skillsQualInput)
                    .filter(feedback => feedback && feedback.trim())
                    .join('; ');

                const skillData = {
                    skillName: skill.jobReqSkillName,
                    averageRating: averageRating.toFixed(1),
                    qualitativeFeedback: qualitativeFeedback || 'No feedback provided',
                    responseCount: validRatings.length
                };

                if (skill.jobReqSkillType === 'Hard') {
                    hardSkills.push(skillData);
                } else {
                    softSkills.push(skillData);
                }
            }
        }

        return { hardSkills, softSkills };

    } catch (error) {
        console.error('Error getting skills report data:', error);
        return { hardSkills: [], softSkills: [] };
    }
},

// Helper function: Calculate feedback summary
calculateFeedbackSummary: function(objectives, skills) {
    const allObjectiveRatings = objectives.map(obj => parseFloat(obj.averageRating)).filter(rating => rating > 0);
    const allHardSkillRatings = skills.hardSkills.map(skill => parseFloat(skill.averageRating)).filter(rating => rating > 0);
    const allSoftSkillRatings = skills.softSkills.map(skill => parseFloat(skill.averageRating)).filter(rating => rating > 0);

    const totalWeightedScore = objectives.reduce((sum, obj) => sum + parseFloat(obj.weightedScore), 0);
    const totalWeight = objectives.reduce((sum, obj) => sum + obj.assignedWeight, 0);

    return {
        objectivesCount: objectives.length,
        hardSkillsCount: skills.hardSkills.length,
        softSkillsCount: skills.softSkills.length,
        averageObjectiveRating: allObjectiveRatings.length > 0 
            ? (allObjectiveRatings.reduce((sum, rating) => sum + rating, 0) / allObjectiveRatings.length).toFixed(1)
            : '0.0',
        averageHardSkillRating: allHardSkillRatings.length > 0 
            ? (allHardSkillRatings.reduce((sum, rating) => sum + rating, 0) / allHardSkillRatings.length).toFixed(1)
            : '0.0',
        averageSoftSkillRating: allSoftSkillRatings.length > 0 
            ? (allSoftSkillRatings.reduce((sum, rating) => sum + rating, 0) / allSoftSkillRatings.length).toFixed(1)
            : '0.0',
        totalWeightedScore: totalWeightedScore.toFixed(2),
        totalWeight: totalWeight,
        overallPerformanceScore: totalWeight > 0 ? (totalWeightedScore / totalWeight).toFixed(1) : '0.0'
    };
},

// DEBUGGING ENDPOINT - Add this to test your database
testDatabaseConnection: async function(req, res) {
    try {
        console.log('🔍 TESTING DATABASE CONNECTION...');
        
        // Test basic tables
        const { data: departments } = await supabase.from('departments').select('*').limit(5);
        const { data: staffaccounts } = await supabase.from('staffaccounts').select('*').limit(5);
        const { data: useraccounts } = await supabase.from('useraccounts').select('*').limit(5);
        
        // Test feedback tables
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        const feedbackData = {};
        
        for (const quarter of quarters) {
            try {
                const { data } = await supabase.from(`feedbacks_${quarter}`).select('*').limit(5);
                feedbackData[quarter] = data || [];
            } catch (error) {
                feedbackData[quarter] = `Error: ${error.message}`;
            }
        }
        
        // Test line manager's data specifically
        const lineManagerId = req.session.user?.userId;
        let lineManagerData = null;
        if (lineManagerId) {
            const { data: lmData } = await supabase
                .from('staffaccounts')
                .select(`
                    *,
                    departments(*),
                    jobpositions(*)
                `)
                .eq('userId', lineManagerId)
                .single();
            lineManagerData = lmData;
        }
        
        res.json({
            success: true,
            departments: departments?.length || 0,
            staffaccounts: staffaccounts?.length || 0,
            useraccounts: useraccounts?.length || 0,
            feedbackData,
            lineManagerData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
},
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
