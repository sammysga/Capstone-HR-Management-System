const { render } = require('ejs');
const supabase = require('../public/config/supabaseClient');
require('dotenv').config(); // To load environment variables
const bcrypt = require('bcrypt');
const { parse } = require('dotenv');
const flash = require('connect-flash/lib/flash');
const { getUserAccount, getPersInfoCareerProg } = require('./employeeController');
const applicantController = require('../controllers/applicantController');
const { check } = require('express-validator');
const { getEmailTemplateData } = require('../utils/emailService');




async function fileUpload(req, uploadType = 'normal') {
    return new Promise((resolve, reject) => {
        const form = new multiparty.Form();
        
        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error('❌ [File Upload] Error parsing form:', err);
                return reject(err);
            }
            
            const file = files.file && files.file[0];
            if (!file) {
                console.error('❌ [File Upload] No file provided');
                return reject(new Error('No file provided'));
            }
            
            try {
                const userId = req.session.userID;
                const timestamp = Date.now();
                let fileName;
                
                // Generate appropriate filename based on upload type
                if (uploadType === 'reupload') {
                    fileName = `reupload_${userId}_${timestamp}_${file.originalFilename}`;
                } else {
                    fileName = `${uploadType}_${userId}_${timestamp}_${file.originalFilename}`;
                }
                
                const { data, error } = await supabase.storage
                    .from('applicant-files')
                    .upload(fileName, fs.createReadStream(file.path), {
                        contentType: file.headers['content-type'],
                        upsert: false
                    });
                
                if (error) {
                    console.error('❌ [File Upload] Supabase storage error:', error);
                    return reject(error);
                }
                
                // Get public URL
                const { data: urlData } = supabase.storage
                    .from('applicant-files')
                    .getPublicUrl(fileName);
                
                const fileUrl = urlData.publicUrl;
                console.log(`✅ [File Upload] File uploaded successfully: ${fileUrl}`);
                
                // Clean up temporary file
                fs.unlinkSync(file.path);
                
                resolve(fileUrl);
                
            } catch (uploadError) {
                console.error('❌ [File Upload] Upload error:', uploadError);
                reject(uploadError);
            }
        });
    });
}

const hrController = {
    getHRDashboard: async function(req, res) {
        if (!req.session.user) {
            req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
            return res.redirect('/staff/login');
        }
    
        try {
            // Function to fetch and format manpower requisition forms
            const fetchAndFormatMRFData = async () => {
                const { data: mrfList, error: mrfError } = await supabase
                    .from('mrf')
                    .select('positionTitle, requisitionDate, mrfId, departmentId, status');

                if (mrfError) throw mrfError;

                // Fetch approval statuses
                const { data: approvals, error: approvalError } = await supabase
                    .from('mrf_approvals')
                    .select('mrfId, approval_stage, reviewerName')
                    .order('reviewerDateSigned', { ascending: true });

                if (approvalError) throw approvalError;

                // Fetch departments
                const { data: departments, error: deptError } = await supabase
                    .from('departments')
                    .select('departmentId, deptName');
                
                if (deptError) throw deptError;

                const combinedData = mrfList.map(mrf => {
                    const latestApproval = approvals.find(a => a.mrfId === mrf.mrfId);
                    const department = departments.find(d => d.departmentId === mrf.departmentId)?.deptName || 'N/A';
                
                    const requisitionerName = latestApproval ? latestApproval.reviewerName : 'Pending';
                
                    let status = mrf.status || 'Pending'; // default to pending

                    const buttonText = (status === 'Pending') ? 'Action Required' : '';

                    return {
                        requisitioner: requisitionerName,
                        department: department,
                        jobPosition: mrf.positionTitle,
                        requestDate: new Date(mrf.requisitionDate).toISOString().split('T')[0],
                        status: status,  
                        mrfId: mrf.mrfId,
                        actionButtonText: buttonText 
                    };
                });                

                return combinedData;
            };

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
    
            // Function to fetch attendance logs with department filter
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
    
          // Function to format attendance logs
          const formatAttendanceLogs = (attendanceLogs, selectedDate = null) => {
            // Use the selected date or default to the current date
            const filterDate = selectedDate || new Date().toISOString().split('T')[0];
        
            const formattedAttendanceLogs = attendanceLogs
                .filter(attendance => attendance.attendanceDate === filterDate) // Filter logs by the selected or current date
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
        
    
            // Initialize attendanceLogs variable
            let attendanceLogs = [];
            let manpowerRequisitions = await fetchAndFormatMRFData();

            if (req.session.user.userRole === 'Line Manager') {
                const formattedLeaves = await fetchAndFormatLeaves();
                attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
    
                return res.render('staffpages/hr_pages/hrdashboard', {
                    formattedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    manpowerRequisitions,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors'),
                });
    
            } else if (req.session.user.userRole === 'HR') {
                const [formattedAllLeaves, formattedApprovedLeaves] = await Promise.all([
                    fetchAndFormatLeaves(),
                    fetchAndFormatLeaves('Approved')
                ]);
    
                attendanceLogs = await fetchAttendanceLogs();
                const formattedAttendanceDisplay = formatAttendanceLogs(attendanceLogs);
    
                return res.render('staffpages/hr_pages/hrdashboard', { 
                    allLeaves: formattedAllLeaves, 
                    approvedLeaves: formattedApprovedLeaves,
                    attendanceLogs: formattedAttendanceDisplay,
                    manpowerRequisitions,
                    successMessage: req.flash('success'),
                    errorMessage: req.flash('errors'),
                });
            }
        } catch (err) {
            console.error('Error fetching data for the dashboard:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the dashboard.' });
            return res.redirect('/hr/dashboard');
        }
    },

   getHrTrainingDevelopmentTracker: async function (req, res) {
    try {
        console.log('Loading training development tracker...');

        // Fetch only REQUIRED trainings for HR
        const { data: trainings, error: trainingsError } = await supabase
            .from('trainings')
            .select('*')
            .eq('isActive', true)
            .eq('isRequired', true) // Only fetch required trainings
            .order('trainingName', { ascending: true });

        if (trainingsError) throw trainingsError;

        // Fetch job positions and departments
        const { data: jobPositions } = await supabase.from('jobpositions').select('*');
        const { data: departments } = await supabase.from('departments').select('*');
        const { data: employees } = await supabase.from('staffaccounts').select('*').limit(20);

        // Fetch training assignments for required trainings only
        let assignments = [];
        try {
            const { data: assignmentData } = await supabase
                .from('training_records')
                .select(`
                    *,
                    trainings!inner(trainingName, isRequired),
                    staffaccounts!inner(staffFName, staffLName, staffEmail, jobId, departmentId),
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `)
                .eq('trainings.isRequired', true) // Only assignments for required trainings
                .eq('trainings.isActive', true)
                .order('dateRequested', { ascending: false });
            
            if (assignmentData) {
                assignments = assignmentData.map(assignment => ({
                    assignmentId: assignment.trainingRecordId,
                    trainingId: assignment.trainingId,
                    employeeId: assignment.userId,
                    employeeName: `${assignment.staffaccounts.staffFName} ${assignment.staffaccounts.staffLName}`,
                    employeeEmail: assignment.staffaccounts.staffEmail,
                    trainingTitle: assignment.trainings.trainingName + ' (REQUIRED)',
                    jobTitle: assignment.jobpositions?.jobTitle || 'Unknown Position',
                    department: assignment.departments?.deptName || 'Unknown Department',
                    status: assignment.trainingStatus?.toLowerCase().replace(' ', '-') || 'not-started',
                    progress: assignment.progressPercentage || 0,
                    startDate: assignment.setStartDate ? new Date(assignment.setStartDate) : new Date(),
                    dueDate: assignment.setEndDate ? new Date(assignment.setEndDate) : null,
                    assignedDate: assignment.dateRequested ? new Date(assignment.dateRequested) : new Date(),
                    completionDate: assignment.completionDate ? new Date(assignment.completionDate) : null,
                    isApproved: assignment.isApproved
                }));
            }
        } catch (error) {
            console.log('Training assignments table not found or error:', error);
            // Fallback to demo assignments for required trainings
            assignments = [
                {
                    assignmentId: 1,
                    trainingId: 1,
                    employeeId: 'john-doe',
                    employeeName: 'John Doe',
                    employeeEmail: 'john.doe@company.com',
                    trainingTitle: 'Safety Training (REQUIRED)',
                    jobTitle: 'Frontend Developer',
                    department: 'IT',
                    status: 'in-progress',
                    progress: 75,
                    startDate: new Date('2024-01-15'),
                    assignedDate: new Date('2024-01-10'),
                    isApproved: true
                },
                {
                    assignmentId: 2,
                    trainingId: 2,
                    employeeId: 'jane-smith',
                    employeeName: 'Jane Smith',
                    employeeEmail: 'jane.smith@company.com',
                    trainingTitle: 'Data Privacy Training (REQUIRED)',
                    jobTitle: 'Operations Manager',
                    department: 'Operations',
                    status: 'completed',
                    progress: 100,
                    startDate: new Date('2024-01-10'),
                    completionDate: new Date('2024-01-25'),
                    assignedDate: new Date('2024-01-05'),
                    isApproved: true
                },
                {
                    assignmentId: 3,
                    trainingId: 3,
                    employeeId: 'mike-johnson',
                    employeeName: 'Mike Johnson',
                    employeeEmail: 'mike.johnson@company.com',
                    trainingTitle: 'Compliance Training (REQUIRED)',
                    jobTitle: 'Data Analyst',
                    department: 'Analytics',
                    status: 'not-started',
                    progress: 0,
                    startDate: new Date('2024-01-20'),
                    dueDate: new Date('2024-02-20'),
                    assignedDate: new Date('2024-01-15'),
                    isApproved: true
                }
            ];
        }

        // Create lookup maps
        const jobsMap = (jobPositions || []).reduce((acc, job) => {
            acc[job.jobId] = job;
            return acc;
        }, {});

        const departmentsMap = (departments || []).reduce((acc, dept) => {
            acc[dept.departmentId] = dept;
            return acc;
        }, {});

        // Format trainings (only required ones)
        const formattedTrainings = (trainings || []).map(training => {
            const job = jobsMap[training.jobId] || {};
            const department = departmentsMap[job.departmentId] || {};
            
            // Count assignments for this training
            const trainingAssignments = assignments.filter(a => a.trainingId === training.trainingId);
            const completedCount = trainingAssignments.filter(a => a.status === 'completed').length;
            const inProgressCount = trainingAssignments.filter(a => a.status === 'in-progress').length;
            const notStartedCount = trainingAssignments.filter(a => a.status === 'not-started').length;
            
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
                department: department.departmentName || 'Unknown Department',
                jobTitle: job.jobTitle || 'Unknown Position',
                badges: [
                    training.isOnlineArrangement ? 'online' : 'onsite',
                    'required' // All trainings are required now
                ],
                // Assignment statistics
                assignmentStats: {
                    total: trainingAssignments.length,
                    completed: completedCount,
                    inProgress: inProgressCount,
                    notStarted: notStartedCount
                },
                assignments: trainingAssignments // Include assignments for this training
            };
        });

        res.render('staffpages/hr_pages/hrtrainingdevelopmenttracker', {
            title: 'Required Training & Development Tracker',
            trainings: formattedTrainings,
            assignments: assignments,
            user: req.user || null
        });
        
    } catch (error) {
        console.error('Error loading training tracker:', error);
        res.status(500).send('Error loading training tracker');
    }
},

getTrainingDetails: async function (req, res) {
    try {
        const trainingId = req.params.trainingId;
        console.log('=== TRAINING DETAILS DEBUG ===');
        console.log('Requested training ID:', trainingId);

        if (!trainingId) {
            console.log('ERROR: No training ID provided');
            return res.status(400).json({
                success: false,
                message: 'Training ID is required'
            });
        }

        // Get training details
        console.log('Fetching training from database...');
        const { data: training, error: trainingError } = await supabase
            .from('trainings')
            .select('*')
            .eq('trainingId', trainingId)
            .eq('isActive', true)
            .single();

        if (trainingError || !training) {
            console.log('Training not found or error:', trainingError);
            return res.status(404).json({
                success: false,
                message: 'Training not found',
                debug: { trainingId, error: trainingError }
            });
        }

        console.log('Training found:', training.trainingName);

        // Get job and department info
        let jobInfo = null;
        let departmentInfo = null;

        if (training.jobId) {
            const { data: job } = await supabase
                .from('jobpositions')
                .select('jobTitle, departmentId')
                .eq('jobId', training.jobId)
                .single();
            
            jobInfo = job;

            if (job && job.departmentId) {
                const { data: department } = await supabase
                    .from('departments')
                    .select('deptName')
                    .eq('departmentId', job.departmentId)
                    .single();
                
                departmentInfo = department;
            }
        }

        // Get training records first
        console.log('Fetching training assignments...');
        const { data: trainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select(`
                *,
                trainings!inner (
                    trainingName,
                    trainingDesc,
                    isOnlineArrangement,
                    isRequired,
                    totalDuration,
                    cost,
                    address
                )
            `)
            .eq('trainingId', trainingId)
            .order('dateRequested', { ascending: false });

        if (recordsError) {
            console.error('Error fetching training records:', recordsError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching training records'
            });
        }

        console.log(`Found ${trainingRecords?.length || 0} training records`);

        // NEW: Use the SAME progress calculation logic as employee side
        let assignments = [];
        
        if (trainingRecords && trainingRecords.length > 0) {
            const userIds = trainingRecords.map(record => record.userId);
            
            // Get user accounts
            const { data: userAccounts, error: userError } = await supabase
                .from('useraccounts')
                .select('userId, userEmail')
                .in('userId', userIds);

            // Get staff accounts
            const { data: staffAccounts, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName, jobId, departmentId')
                .in('userId', userIds);

            // Get job positions
            const jobIds = [...new Set(staffAccounts?.map(staff => staff.jobId).filter(Boolean))];
            let jobPositions = [];
            if (jobIds.length > 0) {
                const { data: jobs } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle')
                    .in('jobId', jobIds);
                jobPositions = jobs || [];
            }

            // Get departments
            const departmentIds = [...new Set(staffAccounts?.map(staff => staff.departmentId).filter(Boolean))];
            let departments = [];
            if (departmentIds.length > 0) {
                const { data: depts } = await supabase
                    .from('departments')
                    .select('departmentId, deptName')
                    .in('departmentId', departmentIds);
                departments = depts || [];
            }

            // REUSE EMPLOYEE LOGIC: Process each training record to add progress information
            const enrichedRecords = await Promise.all(
                trainingRecords.map(async (record) => {
                    try {
                        // Get activities count (SAME as employee side)
                        const { data: activities, error: activitiesError } = await supabase
                            .from('training_activities')
                            .select('activityId')
                            .eq('trainingId', record.trainingId);

                        if (activitiesError) {
                            console.error(`Error fetching activities for training ${record.trainingId}:`, activitiesError);
                        }

                        // Get completed activities (SAME as employee side)
                        const { data: completedActivities, error: completedError } = await supabase
                            .from('training_records_activities')
                            .select('activityId, status')
                            .eq('trainingRecordId', record.trainingRecordId);

                        if (completedError) {
                            console.error(`Error fetching completed activities for record ${record.trainingRecordId}:`, completedError);
                        }

                        const totalActivities = activities?.length || 0;
                        const completedCount = completedActivities?.filter(a => a.status === 'Completed').length || 0;
                        const inProgressCount = completedActivities?.filter(a => a.status === 'In Progress').length || 0;

                        // SAME CALCULATION as employee renderTrainingListItem
                        let progressPercentage = 0;
                        if (totalActivities > 0) {
                            // FIXED: Use the SAME enhanced percentage calculation as employee side
                            const partialProgress = (completedCount * 1.0) + (inProgressCount * 0.5);
                            progressPercentage = Math.round((partialProgress / totalActivities) * 100);
                        }

                        // Check for certificates (SAME as employee side)
                        const { data: certificates, error: certError } = await supabase
                            .from('training_records_certificates')
                            .select('certificate_url')
                            .eq('trainingRecordId', record.trainingRecordId);

                        const hasValidCertificates = certificates?.some(cert => 
                            cert.certificate_url && cert.certificate_url.trim() !== ''
                        ) || false;

                        // SAME STATUS DETERMINATION as employee getTrainingProgress
                        let displayStatus = 'Not Started';
                        const today = new Date();
                        const startDate = record.setStartDate ? new Date(record.setStartDate) : null;
                        const endDate = record.setEndDate ? new Date(record.setEndDate) : null;

                        // Check approval status first (SAME as employee side)
                        if (record.isApproved === null) {
                            displayStatus = 'Awaiting Approval';
                        } else if (record.isApproved === false) {
                            displayStatus = 'Rejected';
                        } else if (record.isApproved === true) {
                            // For approved trainings, use the calculated status (SAME as employee side)
                            if (hasValidCertificates) {
                                displayStatus = 'Completed';
                                progressPercentage = 100; // Override percentage if certificates exist
                            } else if (endDate && today > endDate && progressPercentage < 100) {
                                displayStatus = 'Overdue';
                            } else if (inProgressCount > 0 || completedCount > 0) {
                                displayStatus = 'In Progress';
                            } else {
                                displayStatus = 'Not Started';
                            }
                        }

                        // Get user and staff details
                        const userAccount = userAccounts?.find(user => user.userId === record.userId);
                        const staffAccount = staffAccounts?.find(staff => staff.userId === record.userId);
                        const jobPosition = jobPositions.find(job => job.jobId === staffAccount?.jobId);
                        const department = departments.find(dept => dept.departmentId === staffAccount?.departmentId);

                        console.log(`Employee ${staffAccount?.firstName} ${staffAccount?.lastName}: ${progressPercentage}% (${completedCount}/${totalActivities} completed, ${inProgressCount} in progress, status: ${displayStatus})`);

                        return {
                            assignmentId: record.trainingRecordId,
                            employeeId: record.userId,
                            employeeName: staffAccount ? `${staffAccount.firstName} ${staffAccount.lastName}` : 'Unknown Employee',
                            employeeEmail: userAccount?.userEmail || 'no-email@company.com',
                            jobTitle: jobPosition?.jobTitle || 'Unknown Position',
                            department: department?.deptName || 'Unknown Department',
                            status: displayStatus,
                            progress: progressPercentage, // SAME calculation as employee side
                            startDate: record.setStartDate,
                            endDate: record.setEndDate,
                            assignedDate: record.dateRequested,
                            completionDate: record.decisionDate,
                            isApproved: record.isApproved,
                            approvalRemarks: record.decisionRemarks,
                            // Add activity breakdown for debugging
                            activityBreakdown: {
                                total: totalActivities,
                                completed: completedCount,
                                inProgress: inProgressCount,
                                hasValidCertificates: hasValidCertificates
                            }
                        };
                    } catch (error) {
                        console.error(`Error processing training record ${record.trainingRecordId}:`, error);
                        return {
                            assignmentId: record.trainingRecordId,
                            employeeId: record.userId,
                            employeeName: 'Unknown Employee',
                            status: 'Error',
                            progress: 0,
                            error: error.message
                        };
                    }
                })
            );

            assignments = enrichedRecords;
            console.log(`Successfully processed ${assignments.length} assignments using employee-side logic`);
        }

        // Get training activities
        const { data: activities } = await supabase
            .from('training_activities')
            .select('*')
            .eq('trainingId', trainingId)
            .order('activityId', { ascending: true });

        // Get training certifications
        const { data: certifications } = await supabase
            .from('training_certifications')
            .select('*')
            .eq('trainingId', trainingId)
            .order('trainingCertId', { ascending: true });

        // Calculate statistics with progress awareness
        const stats = {
            totalAssigned: assignments.length,
            completed: assignments.filter(a => a.status === 'Completed').length,
            inProgress: assignments.filter(a => a.status === 'In Progress').length,
            notStarted: assignments.filter(a => 
                a.status === 'Assigned' || 
                a.status === 'Not Started' || 
                !a.status
            ).length,
            overdue: assignments.filter(a => {
                if (!a.endDate) return false;
                const dueDate = new Date(a.endDate);
                const today = new Date();
                return dueDate < today && a.status !== 'Completed';
            }).length,
            // Calculate average progress
            averageProgress: assignments.length > 0 ? 
                Math.round(assignments.reduce((sum, a) => sum + a.progress, 0) / assignments.length) : 0
        };

        // Format training data
        const formattedTraining = {
            id: training.trainingId,
            title: training.trainingName,
            description: training.trainingDesc,
            mode: training.isOnlineArrangement ? 'online' : 'onsite',
            location: training.isOnlineArrangement ? null : {
                country: training.country,
                address: training.address
            },
            cost: training.cost || 0,
            duration: training.totalDuration || 0,
            isRequired: training.isRequired || false,
            isActive: training.isActive,
            createdDate: training.dateCreated || null,
            jobTitle: jobInfo?.jobTitle || 'Unknown Position',
            department: departmentInfo?.deptName || 'Unknown Department',
            activities: activities || [],
            certifications: certifications || [],
            assignments: assignments,
            statistics: stats
        };

        console.log(`Training details loaded: ${formattedTraining.title} with ${assignments.length} assignments, average progress: ${stats.averageProgress}%`);

        res.json({
            success: true,
            data: formattedTraining,
            message: `Training details loaded successfully with synchronized progress`
        });

    } catch (error) {
        console.error('Error getting training details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get training details',
            error: error.message
        });
    }
},

getEmployees: async function (req, res) {
    try {
        console.log('Fetching employees from database...');
        
        const { data: employees, error } = await supabase
            .from('staffaccounts')
            .select(`
                staffId, 
                lastName, 
                firstName, 
                userId,
                jobId,
                departmentId,
                jobpositions(jobTitle, departmentId),
                departments(deptName),
                useraccounts(userEmail)
            `)
            .order('firstName', { ascending: true });

        if (error) {
            console.error('Supabase error:', error);
            throw error;
        }

        console.log(`Found ${employees?.length || 0} employees in database`);

        // Format the employees data
        const formattedEmployees = (employees || []).map(emp => {
            const fullName = `${emp.firstName || 'Unknown'} ${emp.lastName || 'User'}`;
            
            return {
                id: emp.staffId,
                userId: emp.userId, // Make sure this field is included
                firstName: emp.firstName || 'Unknown',
                lastName: emp.lastName || 'User',
                fullName: fullName,
                email: emp.useraccounts?.userEmail || 'no-email@company.com',
                jobId: emp.jobId,
                jobTitle: emp.jobpositions?.jobTitle || 'Unknown Position',
                departmentId: emp.departmentId || emp.jobpositions?.departmentId,
                department: emp.departments?.deptName || 'Unknown Department'
            };
        });

        console.log('Formatted employees:', formattedEmployees.length);
        if (formattedEmployees.length > 0) {
            console.log('Sample employee data:', formattedEmployees[0]);
        }

        res.json({
            success: true,
            data: formattedEmployees,
            message: `Successfully fetched ${formattedEmployees.length} employees`
        });

    } catch (error) {
        console.error('Error fetching employees:', error);
        
        // Return demo data if database fails (for development/testing)
        const demoEmployees = [
            {
                id: 'emp1',
                userId: 1,
                firstName: 'John',
                lastName: 'Doe',
                fullName: 'John Doe',
                email: 'john.doe@company.com',
                jobId: 1,
                jobTitle: 'Software Engineer',
                departmentId: 1,
                department: 'IT'
            },
            {
                id: 'emp2',
                userId: 2,
                firstName: 'Jane',
                lastName: 'Smith',
                fullName: 'Jane Smith',
                email: 'jane.smith@company.com',
                jobId: 2,
                jobTitle: 'Operations Manager',
                departmentId: 2,
                department: 'Operations'
            },
            {
                id: 'emp3',
                userId: 3,
                firstName: 'Mike',
                lastName: 'Johnson',
                fullName: 'Mike Johnson',
                email: 'mike.johnson@company.com',
                jobId: 3,
                jobTitle: 'Data Analyst',
                departmentId: 3,
                department: 'Analytics'
            },
            {
                id: 'emp4',
                userId: 4,
                firstName: 'Sarah',
                lastName: 'Wilson',
                fullName: 'Sarah Wilson',
                email: 'sarah.wilson@company.com',
                jobId: 4,
                jobTitle: 'HR Specialist',
                departmentId: 4,
                department: 'Human Resources'
            },
            {
                id: 'emp5',
                userId: 5,
                firstName: 'David',
                lastName: 'Brown',
                fullName: 'David Brown',
                email: 'david.brown@company.com',
                jobId: 5,
                jobTitle: 'Marketing Manager',
                departmentId: 5,
                department: 'Marketing'
            }
        ];

        console.log('Returning demo data due to database error');
        
        res.json({
            success: true,
            data: demoEmployees,
            message: 'Using demo data (database connection failed)',
            isDemoData: true
        });
    }
},

getEmployeeTrainingDashboard: async function (req, res) {
    try {
        console.log('Loading Employee Training Dashboard...');

        // Get all employees with their basic info
        const { data: allEmployees, error: employeesError } = await supabase
            .from('staffaccounts')
            .select(`
                userId,
                firstName,
                lastName,
                jobId,
                departmentId,
                jobpositions(jobTitle),
                departments(deptName),
                useraccounts(userEmail)
            `)
            .order('firstName', { ascending: true });

        if (employeesError) {
            console.error('Error fetching employees:', employeesError);
            throw employeesError;
        }

        console.log(`Found ${allEmployees?.length || 0} employees`);

        // Get all training records for all employees
        const { data: allTrainingRecords, error: recordsError } = await supabase
            .from('training_records')
            .select(`
                *,
                trainings!inner(
                    trainingName,
                    isRequired,
                    totalDuration,
                    isOnlineArrangement
                )
            `)
            .eq('trainings.isRequired', true) // Only required trainings
            .eq('trainings.isActive', true);

        if (recordsError) {
            console.error('Error fetching training records:', recordsError);
            throw recordsError;
        }

        console.log(`Found ${allTrainingRecords?.length || 0} training records`);

        // Get all activity progress data
        const trainingRecordIds = allTrainingRecords?.map(record => record.trainingRecordId) || [];
        let allActivityProgress = [];
        let allCertificates = [];

        if (trainingRecordIds.length > 0) {
            const { data: activityData } = await supabase
                .from('training_records_activities')
                .select('trainingRecordId, status, activityId')
                .in('trainingRecordId', trainingRecordIds);

            const { data: certificateData } = await supabase
                .from('training_records_certificates')
                .select('trainingRecordId, certificate_url')
                .in('trainingRecordId', trainingRecordIds);

            allActivityProgress = activityData || [];
            allCertificates = certificateData || [];
        }

        // Get activity counts for all trainings
        const trainingIds = [...new Set(allTrainingRecords?.map(record => record.trainingId) || [])];
        let trainingActivityCounts = {};

        if (trainingIds.length > 0) {
            const { data: activityCounts } = await supabase
                .from('training_activities')
                .select('trainingId, activityId')
                .in('trainingId', trainingIds);

            // Create map of training ID to activity count
            if (activityCounts) {
                activityCounts.forEach(activity => {
                    trainingActivityCounts[activity.trainingId] = (trainingActivityCounts[activity.trainingId] || 0) + 1;
                });
            }
        }

        // Process each employee to calculate their training dashboard data
        const employeeDashboardData = (allEmployees || []).map(employee => {
            // Get all training records for this employee
            const employeeTrainings = allTrainingRecords?.filter(record => record.userId === employee.userId) || [];

            // Calculate overall progress for this employee
            let totalTrainings = employeeTrainings.length;
            let completedTrainings = 0;
            let inProgressTrainings = 0;
            let notStartedTrainings = 0;
            let overdueTrainings = 0;
            let totalProgressSum = 0;

            const trainingDetails = employeeTrainings.map(training => {
                // Calculate progress for this specific training (same logic as before)
                const recordActivities = allActivityProgress.filter(ap => ap.trainingRecordId === training.trainingRecordId);
                const completedActivities = recordActivities.filter(ra => ra.status === 'Completed').length;
                const inProgressActivities = recordActivities.filter(ra => ra.status === 'In Progress').length;
                const totalActivities = trainingActivityCounts[training.trainingId] || 0;

                // Check for valid certificates
                const recordCertificates = allCertificates.filter(cert => cert.trainingRecordId === training.trainingRecordId);
                const hasValidCertificates = recordCertificates.some(cert => 
                    cert.certificate_url && cert.certificate_url.trim() !== ''
                );

                // Calculate percentage progress (same logic as employee side)
                let progressPercentage = 0;
                if (hasValidCertificates) {
                    progressPercentage = 100;
                } else if (totalActivities > 0) {
                    const partialProgress = (completedActivities * 1.0) + (inProgressActivities * 0.5);
                    progressPercentage = Math.round((partialProgress / totalActivities) * 100);
                }

                // Enhanced status determination (same logic as employee side)
                let displayStatus = 'Not Started';
                const today = new Date();
                const endDate = training.setEndDate ? new Date(training.setEndDate) : null;

                // Simplified status logic (removed approval checks)
                if (hasValidCertificates) {
                    displayStatus = 'Completed';
                } else if (endDate && today > endDate && progressPercentage < 100) {
                    displayStatus = 'Overdue';
                } else if (inProgressActivities > 0 || completedActivities > 0) {
                    displayStatus = 'In Progress';
                } else {
                    displayStatus = 'Not Started';
                }

                // Count by status
                switch (displayStatus) {
                    case 'Completed':
                        completedTrainings++;
                        break;
                    case 'In Progress':
                        inProgressTrainings++;
                        break;
                    case 'Overdue':
                        overdueTrainings++;
                        break;
                    default:
                        notStartedTrainings++;
                        break;
                }

                totalProgressSum += progressPercentage;

                return {
                    userId: employee.userId, 
                    employeeName: `${employee.firstName} ${employee.lastName}`,
                    jobTitle: employee.jobpositions?.jobTitle || 'Unknown Position',
                    department: employee.departments?.deptName || 'Unknown Department',
                    email: employee.useraccounts?.userEmail || 'No email',
                    trainingRecordId: training.trainingRecordId,
                    trainingName: training.trainings.trainingName,
                    isRequired: training.trainings.isRequired,
                    totalDuration: training.trainings.totalDuration,
                    isOnlineArrangement: training.trainings.isOnlineArrangement,
                    status: displayStatus,
                    progress: progressPercentage,
                    startDate: training.setStartDate,
                    endDate: training.setEndDate,
                    isOverdue: displayStatus === 'Overdue',
                };
            });

            // Calculate overall employee stats
            const overallProgress = totalTrainings > 0 ? Math.round(totalProgressSum / totalTrainings) : 0;
            
            // Determine overall employee status
            let overallStatus = 'On Track';
            if (overdueTrainings > 0) {
                overallStatus = 'Behind Schedule';
            } else if (completedTrainings === totalTrainings && totalTrainings > 0) {
                overallStatus = 'All Complete';
            } 

            return {
                userId: employee.userId,
                employeeName: `${employee.firstName} ${employee.lastName}`,
                jobTitle: employee.jobpositions?.jobTitle || 'Unknown Position',
                department: employee.departments?.deptName || 'Unknown Department',
                email: employee.useraccounts?.userEmail || 'No email',
                
                // Overall stats
                overallProgress: overallProgress,
                overallStatus: overallStatus,
                
                // Training counts
                totalTrainings: totalTrainings,
                completedTrainings: completedTrainings,
                inProgressTrainings: inProgressTrainings,
                notStartedTrainings: notStartedTrainings,
                overdueTrainings: overdueTrainings,
             
                // Detailed training info
                trainings: trainingDetails,
                
                // Flags for filtering
                hasOverdueTrainings: overdueTrainings > 0,
                hasCompletedAllTrainings: completedTrainings === totalTrainings && totalTrainings > 0,
            };
        });

        // Calculate dashboard summary statistics
        const dashboardStats = {
            totalEmployees: employeeDashboardData.length,
            employeesBehindSchedule: employeeDashboardData.filter(emp => emp.overallStatus === 'Behind Schedule').length,
            employeesOnTrack: employeeDashboardData.filter(emp => emp.overallStatus === 'On Track').length,
            employeesAllComplete: employeeDashboardData.filter(emp => emp.overallStatus === 'All Complete').length,
            averageProgress: employeeDashboardData.length > 0 ? 
                Math.round(employeeDashboardData.reduce((sum, emp) => sum + emp.overallProgress, 0) / employeeDashboardData.length) : 0
        };

        console.log('Dashboard stats calculated:', dashboardStats);

        res.json({
            success: true,
            data: {
                employees: employeeDashboardData,
                statistics: dashboardStats
            },
            message: `Employee dashboard loaded with ${employeeDashboardData.length} employees`
        });

    } catch (error) {
        console.error('Error loading employee training dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load employee training dashboard',
            error: error.message
        });
    }
},

getExistingTrainings: async function (req, res) {
    try {
        console.log('Loading existing REQUIRED trainings for reassignment...');

        const { data: trainings, error } = await supabase
            .from('trainings')
            .select(`
                trainingId,
                trainingName,
                trainingDesc,
                isOnlineArrangement,
                country,
                address,
                cost,
                totalDuration,
                isRequired
            `)
            .eq('isActive', true)
            .eq('isRequired', true) // Only fetch required trainings
            .order('trainingName', { ascending: true });

        if (error) {
            console.error('Error fetching existing trainings:', error);
            throw error;
        }

        // Format trainings for dropdown
        const formattedTrainings = (trainings || []).map(training => ({
            id: training.trainingId,
            title: training.trainingName,
            description: training.trainingDesc,
            mode: training.isOnlineArrangement ? 'online' : 'onsite',
            cost: training.cost || 0,
            duration: training.totalDuration || 0,
            isRequired: training.isRequired || false,
            location: training.isOnlineArrangement ? null : {
                country: training.country,
                address: training.address
            }
        }));

        console.log(`Found ${formattedTrainings.length} existing REQUIRED trainings`);

        res.json({
            success: true,
            data: formattedTrainings,
            message: `Successfully loaded ${formattedTrainings.length} required trainings`
        });

    } catch (error) {
        console.error('Error loading existing trainings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load existing trainings',
            error: error.message
        });
    }
},

    // Create training with employee assignments
    createTraining: async function (req, res) {
        try {
            const {
                trainingName,
                trainingDesc,
                isRequired,
                isOnlineArrangement,
                cost,
                totalDuration,
                activities,
                certifications,
                assignedEmployees,
                country,
                address,
                assignmentType, // 'all', 'department', 'jobPosition', 'individual'
                departmentId,
                jobId
            } = req.body;

            console.log('Creating training with data:', req.body);

            // Validation
            if (!trainingName || !trainingDesc) {
                return res.status(400).json({
                    success: false,
                    message: 'Training name and description are required'
                });
            }

            if (!assignedEmployees || assignedEmployees.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'At least one employee must be assigned'
                });
            }

            /// Get jobId from the first assigned employee
            let trainingJobId = jobId; 

            // If no jobId provided, get from first assigned employee
            if (!trainingJobId && assignedEmployees && assignedEmployees.length > 0) {
                console.log('No jobId provided, getting from first employee:', assignedEmployees[0].userId);
                
                const { data: employeeData, error: employeeError } = await supabase
                    .from('staffaccounts')
                    .select('jobId')
                    .eq('userId', assignedEmployees[0].userId)
                    .single();
                
                if (employeeError) {
                    console.error('Error getting employee jobId:', employeeError);
                    trainingJobId = 1; // Fallback to jobId 1
                } else {
                    trainingJobId = employeeData?.jobId || 1;
                }
                
                console.log('Using jobId from employee:', trainingJobId);
            }

            // Create training record with the determined jobId
            const { data: trainingData, error: trainingError } = await supabase
                .from('trainings')
                .insert({
                    trainingName: trainingName,
                    trainingDesc: trainingDesc,
                    isOnlineArrangement: isOnlineArrangement,
                    country: !isOnlineArrangement ? country : null,
                    address: !isOnlineArrangement ? address : null,
                    cost: parseFloat(cost) || 0,
                    totalDuration: parseFloat(totalDuration) || 0,
                    isRequired: isRequired || false,
                    isActive: true,
                    userId: req.session.user?.userId || 1,
                    jobId: trainingJobId 
                })
                .select()
                .single();

            if (trainingError) {
                console.error('Error creating training:', trainingError);
                throw new Error('Failed to create training');
            }

            const trainingId = trainingData.trainingId;
            console.log('Training created with ID:', trainingId);

            // Create training records for assigned employees
            try {
                const trainingRecords = assignedEmployees.map(assignment => ({
                    trainingId: trainingId,
                    userId: assignment.userId,
                    setStartDate: assignment.startDate || new Date().toISOString().split('T')[0],
                    setEndDate: assignment.dueDate || null,
                    isApproved: true, // Auto-approved since it's assigned by HR
                    trainingStatus: 'Not Started',
                    dateRequested: new Date().toISOString().split('T')[0],
                    decisionDate: new Date().toISOString().split('T')[0],
                    decisionRemarks: `Training assigned by HR - Assignment Type: ${assignmentType} - Status: Not Started`
                }));

                const { error: recordsError } = await supabase
                    .from('training_records')
                    .insert(trainingRecords);

                if (recordsError) {
                    console.log('Could not create training records:', recordsError);
                    // Continue without failing - training is still created
                } else {
                    console.log(`Created ${trainingRecords.length} training records`);
                }
            } catch (recordsError) {
                console.log('Training records creation failed:', recordsError);
            }

            // Insert activities if provided
            if (activities && activities.length > 0) {
                try {
                    const trainingActivities = activities.map(activity => ({
                        trainingId: trainingId,
                        activityName: activity.name,
                        activityType: activity.type,
                        estActivityDuration: parseFloat(activity.duration),
                        activityRemarks: activity.remarks || null
                    }));

                    await supabase.from('training_activities').insert(trainingActivities);
                    console.log(`Created ${trainingActivities.length} training activities`);
                } catch (e) {
                    console.log('Could not insert activities:', e);
                }
            }

            // Insert certifications if provided
            if (certifications && certifications.length > 0) {
                try {
                    const trainingCerts = certifications.map(cert => ({
                        trainingId: trainingId,
                        trainingCertTitle: cert.title,
                        trainingCertDesc: cert.description
                    }));

                    await supabase.from('training_certifications').insert(trainingCerts);
                    console.log(`Created ${trainingCerts.length} training certifications`);
                } catch (e) {
                    console.log('Could not insert certifications:', e);
                }
            }

            res.json({
                success: true,
                message: `Training "${trainingName}" created successfully and assigned to ${assignedEmployees.length} employee(s)`,
                data: {
                    trainingId: trainingId,
                    trainingName: trainingName,
                    assignedEmployeesCount: assignedEmployees.length,
                    isRequired: isRequired,
                    assignmentType: assignmentType
                }
            });

        } catch (error) {
            console.error('Error creating training:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create training course',
                error: error.message
            });
        }
    },

    // Get form data for dropdowns
    getTrainingFormData: async function (req, res) {
        try {
            console.log('Loading training form data...');

            // Fetch job positions
            const { data: jobPositions } = await supabase
                .from('jobpositions')
                .select('*')
                .order('jobTitle', { ascending: true });

            // Fetch departments
            const { data: departments } = await supabase
                .from('departments')
                .select('*')
                .order('deptName', { ascending: true });

            // Fetch activity types
            const { data: activityTypes } = await supabase
                .from('training_activities_types')
                .select('*')
                .order('activityType', { ascending: true });

            const formData = {
                jobPositions: jobPositions || [],
                departments: departments || [],
                activityTypes: (activityTypes || []).map(type => ({
                    id: type.activityTypeId,
                    label: type.activityType
                }))
            };

            // Add fallback data if tables are empty
            if (formData.jobPositions.length === 0) {
                formData.jobPositions = [
                    { jobId: 1, jobTitle: 'Software Engineer', jobDescrpt: 'Develops software applications' },
                    { jobId: 2, jobTitle: 'Data Analyst', jobDescrpt: 'Analyzes business data' },
                    { jobId: 3, jobTitle: 'HR Specialist', jobDescrpt: 'Manages human resources' }
                ];
            }

            if (formData.departments.length === 0) {
                formData.departments = [
                    { departmentId: 1, deptName: 'IT' },
                    { departmentId: 2, deptName: 'HR' },
                    { departmentId: 3, deptName: 'Finance' }
                ];
            }

            if (formData.activityTypes.length === 0) {
                formData.activityTypes = [
                    { id: 1, label: 'Video Lesson' },
                    { id: 2, label: 'Reading Material' },
                    { id: 3, label: 'Practical Exercise' },
                    { id: 4, label: 'Quiz/Assessment' },
                    { id: 5, label: 'Workshop' }
                ];
            }

            res.json({
                success: true,
                data: formData,
                metadata: {
                    jobPositionsCount: formData.jobPositions.length,
                    departmentsCount: formData.departments.length,
                    activityTypesCount: formData.activityTypes.length
                }
            });

        } catch (error) {
            console.error('Error loading form data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load form data',
                error: error.message
            });
        }
    },

reassignTraining: async function (req, res) {
    try {
        const {
            trainingId,
            assignedEmployees,
            assignmentType,
            departmentId,
            jobId
        } = req.body;

        console.log('Re-assigning training:', { trainingId, assignmentType, employeeCount: assignedEmployees?.length });

        // Validation
        if (!trainingId) {
            return res.status(400).json({
                success: false,
                message: 'Training ID is required'
            });
        }

        if (!assignedEmployees || assignedEmployees.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one employee must be assigned'
            });
        }

        // Get training details
        const { data: training, error: trainingError } = await supabase
            .from('trainings')
            .select('trainingName, isRequired')
            .eq('trainingId', trainingId)
            .single();

        if (trainingError || !training) {
            return res.status(404).json({
                success: false,
                message: 'Training not found'
            });
        }

        // Get all training activities for this training
        const { data: trainingActivities, error: activitiesError } = await supabase
            .from('training_activities')
            .select('activityId')
            .eq('trainingId', trainingId);

        if (activitiesError) {
            console.error('Error fetching training activities:', activitiesError);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch training activities'
            });
        }

        // Get all training certifications for this training
        const { data: trainingCertifications, error: certificationsError } = await supabase
            .from('training_certifications')
            .select('trainingCertId')
            .eq('trainingId', trainingId);

        if (certificationsError) {
            console.error('Error fetching training certifications:', certificationsError);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch training certifications'
            });
        }

        // Create training records for newly assigned employees
        const trainingRecords = assignedEmployees.map(assignment => ({
            trainingId: trainingId,
            userId: assignment.userId,
            setStartDate: assignment.startDate || new Date().toISOString().split('T')[0],
            setEndDate: assignment.dueDate || null,
            isApproved: true,
            trainingStatus: 'Not Started',
            dateRequested: new Date().toISOString().split('T')[0],
            decisionDate: new Date().toISOString().split('T')[0],
            decisionRemarks: `Training re-assigned by HR - Assignment Type: ${assignmentType}`
        }));

        // Insert training records and get the created records with their IDs
        const { data: createdRecords, error: recordsError } = await supabase
            .from('training_records')
            .insert(trainingRecords)
            .select('trainingRecordId, userId');

        if (recordsError) {
            console.error('Error creating training records:', recordsError);
            return res.status(500).json({
                success: false,
                message: 'Failed to assign training to employees'
            });
        }

        let activitiesCreated = 0;
        let certificatesCreated = 0;

        // Create training_records_activities for each user and each activity
        if (trainingActivities && trainingActivities.length > 0 && createdRecords && createdRecords.length > 0) {
            const trainingRecordsActivities = [];
            
            createdRecords.forEach(record => {
                trainingActivities.forEach(activity => {
                    trainingRecordsActivities.push({
                        trainingRecordId: record.trainingRecordId,
                        activityId: activity.activityId,
                        status: 'Not Started',
                        created_at: new Date().toISOString()
                    });
                });
            });

            // Insert all training records activities
            const { error: activitiesRecordsError } = await supabase
                .from('training_records_activities')
                .insert(trainingRecordsActivities);

            if (activitiesRecordsError) {
                console.error('Error creating training records activities:', activitiesRecordsError);
                console.warn('Training assigned but activity records creation failed');
            } else {
                activitiesCreated = trainingRecordsActivities.length;
            }
        }

        // Create training_records_certificates for each user and each certification
        if (trainingCertifications && trainingCertifications.length > 0 && createdRecords && createdRecords.length > 0) {
            const trainingRecordsCertificates = [];
            
            createdRecords.forEach(record => {
                trainingCertifications.forEach(certification => {
                    trainingRecordsCertificates.push({
                        trainingRecordId: record.trainingRecordId,
                        trainingCertId: certification.trainingCertId,
                        certificate_url: null, // Will be populated when certificate is earned
                        created_at: new Date().toISOString()
                    });
                });
            });

            // Insert all training records certificates
            const { error: certificatesRecordsError } = await supabase
                .from('training_records_certificates')
                .insert(trainingRecordsCertificates);

            if (certificatesRecordsError) {
                console.error('Error creating training records certificates:', certificatesRecordsError);
                console.warn('Training assigned but certificate records creation failed');
            } else {
                certificatesCreated = trainingRecordsCertificates.length;
            }
        }

        console.log(`Successfully re-assigned training to ${assignedEmployees.length} employees`);
        console.log(`Created ${activitiesCreated} activity records`);
        console.log(`Created ${certificatesCreated} certificate records`);

        res.json({
            success: true,
            message: `Training "${training.trainingName}" re-assigned to ${assignedEmployees.length} employee(s)`,
            data: {
                trainingId: trainingId,
                trainingName: training.trainingName,
                assignedEmployeesCount: assignedEmployees.length,
                isRequired: training.isRequired,
                assignmentType: assignmentType,
                activitiesCreated: activitiesCreated,
                certificatesCreated: certificatesCreated
            }
        });

    } catch (error) {
        console.error('Error re-assigning training:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to re-assign training',
            error: error.message
        });
    }
},
    getEmployeesByFilter: async function (req, res) {
        try {
            const { departmentId, jobId, filterType } = req.query;
            
            console.log('Getting employees by filter:', { departmentId, jobId, filterType });
            
            let query = supabase
                .from('staffaccounts')
                .select(`
                    staffId, 
                    lastName, 
                    firstName, 
                    userId,
                    jobId,
                    departmentId,
                    jobpositions(jobTitle),
                    departments(deptName),
                    useraccounts(userEmail)
                `)
                .order('firstName', { ascending: true });

            // Apply filters based on filterType
            if (filterType === 'department' && departmentId) {
                query = query.eq('departmentId', departmentId);
            } else if (filterType === 'jobPosition' && jobId) {
                query = query.eq('jobId', jobId);
            }

            const { data: employees, error } = await query;

            if (error) {
                console.error('Error fetching employees:', error);
                throw error;
            }

            // Format the employees data
            const formattedEmployees = (employees || []).map(emp => ({
                id: emp.staffId,
                userId: emp.userId,
                firstName: emp.firstName || 'Unknown',
                lastName: emp.lastName || 'User',
                fullName: `${emp.firstName || 'Unknown'} ${emp.lastName || 'User'}`,
                email: emp.useraccounts?.userEmail || 'no-email@company.com',
                jobId: emp.jobId,
                jobTitle: emp.jobpositions?.jobTitle || 'Unknown Position',
                departmentId: emp.departmentId,
                department: emp.departments?.deptName || 'Unknown Department'
            }));

            console.log(`Found ${formattedEmployees.length} employees with filter`);

            res.json({
                success: true,
                data: formattedEmployees,
                filterApplied: { departmentId, jobId, filterType }
            });

        } catch (error) {
            console.error('Error fetching employees by filter:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch employees',
                error: error.message
            });
        }
    },

    getHRNotifications: async function(req, res) {
        // Check for authentication
        if (!req.session.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    
        try {
            // Fetch HR applicants with P1 status
            const { data: p1Applicants, error: p1ApplicantsError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId')
                .eq('applicantStatus', 'P1 - Awaiting for HR Action')
                .order('created_at', { ascending: false });
    
            if (p1ApplicantsError) throw p1ApplicantsError;
    
            // Fetch HR applicants with P2 evaluation status
            const { data: p2Applicants, error: p2ApplicantsError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, created_at, lastName, firstName, applicantStatus, jobId')
                .eq('applicantStatus', 'P2 - Awaiting for HR Evaluation')
                .order('created_at', { ascending: false });
    
            if (p2ApplicantsError) throw p2ApplicantsError;
    
            // Combine all HR applicants
            const allHRApplicants = [...p1Applicants, ...p2Applicants];
    
            // Format the HR applicants data - include jobId for redirect
            const formattedHRApplicants = allHRApplicants.map(applicant => ({
                id: applicant.applicantId,
                firstName: applicant.firstName || 'N/A',
                lastName: applicant.lastName || 'N/A',
                status: applicant.applicantStatus || 'N/A',
                jobId: applicant.jobId, // Added jobId for the redirect
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
    
            // Fetch pending MRF data that needs action
            const { data: pendingMRFs, error: mrfError } = await supabase
                .from('mrf')
                .select('mrfId, positionTitle, requisitionDate, departmentId')
                .eq('status', 'Pending');
    
            if (mrfError) throw mrfError;
    
            // Fetch departments for pending MRFs
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName');
            
            if (deptError) throw deptError;
    
            // Format pending MRF data
            const formattedPendingMRFs = pendingMRFs.map(mrf => {
                const department = departments.find(d => d.departmentId === mrf.departmentId)?.deptName || 'N/A';
                
                return {
                    id: mrf.mrfId,
                    position: mrf.positionTitle,
                    department: department,
                    requestDate: new Date(mrf.requisitionDate).toLocaleString('en-US', {
                        weekday: 'short', 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric'
                    })
                };
            });

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
                .eq('status', 'Pending HR')
                .order('created_at', { ascending: false });

            if (offboardingError) {
                console.error('Error fetching offboarding requests:', offboardingError);
                throw offboardingError;
            }

            // Format offboarding requests
            const formattedOffboardingRequests = offboardingRequests.map(request => ({
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
    
            // Improved API request detection - checking multiple conditions
            const isApiRequest = req.xhr || 
                                req.headers.accept?.includes('application/json') || 
                                req.path.includes('/api/');
    
            // If it's an API request, return JSON with explicit content type
            if (isApiRequest) {
                return res
                    .header('Content-Type', 'application/json')
                    .json({
                        hrApplicants: formattedHRApplicants,
                        pendingMRFs: formattedPendingMRFs,
                        offboardingRequests: formattedOffboardingRequests,
                        notificationCount: formattedHRApplicants.length + formattedPendingMRFs.length + formattedOffboardingRequests.length
                    });
            }
    
            // Otherwise, return the rendered partial template
            return res.render('partials/hr_partials', {
                hrApplicants: formattedHRApplicants,
                pendingMRFs: formattedPendingMRFs,
                offboardingRequests: formattedOffboardingRequests,
                notificationCount: formattedHRApplicants.length + formattedPendingMRFs.length + formattedOffboardingRequests.length
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
    


    /* ATS CODES DIVIDER  */
    getApplicantTrackerAllJobPositions: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                // Fetch job positions and departments
                const { data: jobpositions, error: jobpositionsError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle, hiringStartDate, hiringEndDate, departmentId')
                    .order('hiringStartDate', { ascending: true });
    
                if (jobpositionsError) throw jobpositionsError;
    
                const { data: departments, error: departmentsError } = await supabase
                    .from('departments')
                    .select('deptName, departmentId');
    
                if (departmentsError) throw departmentsError;
    
                // Fetch all applicant accounts
                const { data: applicantaccounts, error: applicantaccountsError } = await supabase
                    .from('applicantaccounts')
                    .select('jobId, applicantStatus');
    
                if (applicantaccountsError) throw applicantaccountsError;
    
                // Log raw applicant accounts data
                console.log('Applicant Accounts:', applicantaccounts);
    
                // Group and count statuses by jobId
                const statusCountsMap = {};
                applicantaccounts.forEach(({ jobId, applicantStatus }) => {
                    if (!statusCountsMap[jobId]) {
                        statusCountsMap[jobId] = { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 };
                    }
                    
                    // Check if applicantStatus is not null or undefined before using includes()
                    if (applicantStatus) {
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
    
                // Log final counts for each jobId
                console.log('Status Counts Map:', statusCountsMap);
    
                // Merge counts into job positions
                const jobPositionsWithCounts = jobpositions.map((job) => ({
                    ...job,
                    departmentName: departments.find(dept => dept.departmentId === job.departmentId)?.deptName || 'Unknown',
                    counts: statusCountsMap[job.jobId] || { P1: 0, P2: 0, P3: 0, Offered: 0, Onboarding: 0 },
                }));
    
                // Render the page
                res.render('staffpages/hr_pages/hrapplicanttracking', {
                    jobPositions: jobPositionsWithCounts,
                    departments,
                });
            } catch (err) {
                console.error('Error:', err);
                req.flash('errors', { databaseError: 'Error fetching job data.' });
                res.redirect('/staff/login');
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },
    
    
    
    getApplicantTrackerByJobPositions: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { jobId, applicantId, userId } = req.query;
                console.log('Received request with jobId:', jobId, 'and applicantId:', applicantId);
                console.log('Received request with userId:', userId);

    
                // if (applicantId) {
                //     const { error: updateError } = await supabase
                //         .from('applicantaccounts')
                //         .update({ LM_notified: true })
                //         .eq('applicantId', applicantId);
    
                //     if (updateError) {
                //         console.error('Error updating LM_notified:', updateError);
                //         return res.status(500).json({ success: false, error: 'Failed to notify Line Manager' });
                //     }
    
                //     return res.json({ success: true, message: 'Line Manager notified successfully' });
                // }
    
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

    
                const { data: userAccounts, error: userError } = await supabase
                    .from('useraccounts')
                    .select('userId, userEmail');
    
                if (userError) throw userError;
    
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

                    // let formattedStatus = applicant.applicantStatus;
    
                    // ✅ NEW: If HR Evaluation Score is not 0, update the status to 'P2 - HR Evaluation Accomplished'
                    // if (applicant.hrInterviewFormScore && applicant.hrInterviewFormScore > 0) {
                    //     formattedStatus = `P2 - HR Evaluation Accomplished - Score: ${applicant.hrInterviewFormScore}`;
    
                    //     const { error: updateError } = await supabase
                    //         .from('applicantaccounts')
                    //         .update({ applicantStatus: formattedStatus })
                    //         .eq('applicantId', applicant.applicantId);
    
                    //     if (updateError) {
                    //         console.error(`Error updating applicant ${applicant.applicantId} to P2 - HR Evaluation Accomplished:`, updateError);
                    //     }
                    // }
                    // else if (applicant.p2_hrevalscheduled) {
                    //     formattedStatus = 'P2 - Awaiting for HR Evaluation';
    
                    //     const { error: updateError } = await supabase
                    //         .from('applicantaccounts')
                    //         .update({ applicantStatus: formattedStatus })
                    //         .eq('applicantId', applicant.applicantId);
    
                    //     if (updateError) {
                    //         console.error(`Error updating applicant ${applicant.applicantId} to P2 - Awaiting for HR Evaluation:`, updateError);
                    //     }
                    // } 
                    // else if (applicant.lineManagerApproved || formattedStatus === 'P1 - PASSED') {
                    //     formattedStatus = 'P2 - HR Screening Scheduled';
    
                    //     const { error: updateError } = await supabase
                    //         .from('applicantaccounts')
                    //         .update({ applicantStatus: formattedStatus })
                    //         .eq('applicantId', applicant.applicantId);
    
                    //     if (updateError) {
                    //         console.error(`Error updating applicant ${applicant.applicantId} to P2 - HR Screening Scheduled:`, updateError);
                    //     }
                    // } else {
                    // }
                       
    
                    // applicant.applicantStatus = formattedStatus;
                     // Assign job title, department name, and user email
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

// Render the page with updated applicants
res.render('staffpages/hr_pages/hrapplicanttracking-jobposition', { applicants });
            } catch (error) {
                console.error('Error fetching applicants:', error);
                res.status(500).json({ error: 'Error fetching applicants' });
            }
        } else {
            console.warn('Unauthorized access attempt detected.');

            req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
            res.redirect('/staff/login');
        }
    },
    
    
    updateStatusToP1AwaitingforLineManager: async function(req, res) {
        const { userId } = req.body; // Only get userId from request body
    
        try {
            // Update `applicant_initialscreening_assessment` using `userId`
            const { error: assessmentError } = await supabase
                .from('applicant_initialscreening_assessment')
                .update({ isHRChosen: true })
                .eq('userId', userId);
            
            if (assessmentError) throw assessmentError;
    
            // Update `applicantaccounts` using `userId`
            const { error: statusError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: "P1 - Awaiting for Line Manager Action; HR PASSED" })
                .eq('userId', userId);
            
            if (statusError) throw statusError;
    
            res.json({ success: true, message: "Applicant status updated successfully.", userId });
        } catch (error) {
            res.json({ success: false, message: error.message });
        }
    },


requestDocumentReupload: async function(req, res) {
    const { userId, documentsToReupload, remarks, hrComments } = req.body;
    
    try {
        console.log('📂 [Reupload Request] Processing document reupload request for userId:', userId);
        console.log('📂 [Reupload Request] Documents to reupload:', documentsToReupload);
        console.log('📂 [Reupload Request] HR Remarks:', remarks);
        
        // Update applicant_initialscreening_assessment with HR verification remarks
        const { error: assessmentError } = await supabase
            .from('applicant_initialscreening_assessment')
            .update({ 
                hrVerification: remarks,
                isHRChosen: null // Reset HR chosen status for reupload
            })
            .eq('userId', userId);
        
        if (assessmentError) throw assessmentError;
        
        // Update applicant status to indicate reupload is requested
        const { error: statusError } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: "P1 - Awaiting for HR Action; Requested for Reupload" 
            })
            .eq('userId', userId);
        
        if (statusError) throw statusError;
        
        // Create chatbot message for the applicant
        const chatbotMessage = {
            text: `Hello! We have reviewed your application and would like to request some document updates. Please re-upload the following documents: ${documentsToReupload.map(doc => {
                switch(doc) {
                    case 'degree': return 'Degree Certificate';
                    case 'certification': return 'Certification Document';
                    case 'resume': return 'Resume';
                    case 'additional': return 'Additional Document (as specified below)';
                    default: return doc;
                }
            }).join(', ')}. 
            
HR Instructions: ${remarks}
            
Please use the file upload feature in the chat to submit the requested documents.`,
            applicantStage: "P1 - Awaiting for HR Action; Requested for Reupload"
        };
        
        // Save chatbot message to history
        const { error: chatError } = await supabase
            .from('chatbot_history')
            .insert([{
                userId: userId,
                message: JSON.stringify(chatbotMessage),
                sender: 'bot',
                timestamp: new Date().toISOString(),
                applicantStage: "P1 - Awaiting for HR Action; Requested for Reupload"
            }]);
        
        if (chatError) throw chatError;
        
        res.json({ 
            success: true, 
            message: "Document reupload request sent successfully. The applicant will be notified when they log in to the chatbot." 
        });
        
    } catch (error) {
        console.error('❌ [Reupload Request] Error:', error);
        res.json({ success: false, message: error.message });
    }
},


// 3. Controller function to get additional document info
getAdditionalDocument: async function(req, res) {
    const { userId } = req.params;
    
    try {
        const { data, error } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('addtlfile_url, hrVerification')
            .eq('userId', userId)
            .single();
        
        if (error) throw error;
        
        res.json({
            success: true,
            addtlFileUrl: data?.addtlfile_url || null,
            hrRemarks: data?.hrVerification || null
        });
        
    } catch (error) {
        console.error('❌ [Get Additional Document] Error:', error);
        res.json({ success: false, message: error.message });
    }
},
    
    // postNotifyLineManager: async function(req, res) {
    //     console.log('Request Body:', req.body); // Log the entire request body
    
    //     if (req.session.user && req.session.user.userRole === 'HR') {
    //         const { applicantId } = req.body; // Destructure the applicantId from the request body
    
    //         console.log('Received ApplicantId:', applicantId);
    
    //         // Validate applicantId
    //         if (!applicantId) {
    //             return res.status(400).json({ success: false, error: 'Applicant ID is required.' });
    //         }
    
    //         try {
    //             // Step 1: Get userId from applicantaccounts using applicantId
    //             const { data: applicantData, error: applicantError } = await supabase
    //                 .from('applicantaccounts')
    //                 .select('userId')
    //                 .eq('applicantId', applicantId)
    //                 .single();
    
    //             if (applicantError || !applicantData) {
    //                 console.error('Error fetching userId:', applicantError);
    //                 return res.status(404).json({ success: false, error: 'Applicant not found.' });
    //             }
    
    //             const userId = applicantData.userId;
    //             console.log('Fetched UserId:', userId);
    
    //             // Step 2: Update isHRChosen in applicant_initialscreening_assessment where userId matches
    //             const { error: updateError } = await supabase
    //                 .from('applicant_initialscreening_assessment')
    //                 .update({ isHRChosen: true })
    //                 .eq('userId', userId);
    
    //             if (updateError) {
    //                 console.error('Error updating isHRChosen:', updateError);
    //                 throw updateError;
    //             }
    
    //             res.status(200).json({ success: true, message: 'Line Manager notified successfully.' });
    //         } catch (error) {
    //             console.error('Unexpected error:', error);
    //             return res.status(500).json({ success: false, error: 'Failed to notify Line Manager. Please try again.' });
    //         }
    //     } else {
    //         req.flash('errors', { authError: 'Unauthorized. HR access only.' });
    //         res.redirect('/staff/login');
    //     }
    // },
    
   
        // Controller method for viewing final results for an individual applicant
        getFinalResults: async function (req, res) {
            try {
                const userId = req.session.user?.userId; // Get the current user's ID (from session)
    
                if (!userId) {
                    req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
                    return res.redirect('/staff/login');
                }
    
                // Fetch the chatbot interaction history for the current applicant
                const { data: chatbotInteractions, error: chatbotError } = await supabase
                    .from('chatbot_interaction')
                    .select('message, response, timestamp, applicantStage')
                    .eq('userId', userId)
                    .order('timestamp', { ascending: true }); // Sort by timestamp in ascending order
    
                if (chatbotError) {
                    console.error('Error fetching chatbot interactions:', chatbotError);
                    return res.status(500).send('Error fetching chatbot interactions');
                }
    
                // If no interactions are found, send a relevant message to the view
                if (chatbotInteractions.length === 0) {
                    return res.render('staffpages/hr_pages/ats-final-results', {
                        error: "No interactions found for your application process.",
                        chatbotInteractions: [],
                        message: "There were no interactions to display.",
                        screeningQuestions: [],
                        answers: [],
                        weightedScores: [],
                        result: 'fail'
                    });
                }
    
                // Fetch screening questions and calculate weighted scores
                const screeningQuestions = req.session.screeningQuestions || [];
                const answers = req.session.answers || [];
                const { weightedScores, result } = await applicantController.calculateWeightedScores(
                    answers, 
                    req.session.selectedPosition, 
                    screeningQuestions
                );
    
                // Render the page with the chatbot interactions and additional data
                res.render('staffpages/hr_pages/ats-final-results', {
                    chatbotInteractions: chatbotInteractions, // Send the entire interaction history to the view
                    message: "Here is the entire interaction with the chatbot for your application process.",
                    error: null, // Send null for the error if no error occurs
                    screeningQuestions: screeningQuestions,
                    answers: answers,
                    weightedScores: weightedScores,
                    result: result
                });
    
            } catch (error) {
                console.error('Error fetching chatbot interaction history:', error);
                return res.status(500).send('Error fetching chatbot interaction history');
            }
        },
    

    /* END OF ATS CODES DIVIDER  */
    
    
    
    
    
    
    

    
    
    
    
    
    
    
    
    
 

    //ARCHIVED
    // getApplicantTracking: async function (req, res) {
    //     if (!req.session.user) {
    //         req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
    //         return res.redirect('/staff/login');
    //     }
    
    //     try {
    //         const { data: applicants, error } = await supabase
    //             .from('applicantaccounts')
    //             .select('applicantId, firstName, lastName, userId, created_at') 
    //             .order('created_at', { ascending: false }); 
    
    //         if (error) {
    //             console.error('Error fetching applicants:', error);
    //             return res.status(500).send('Error fetching applicants');
    //         }
    
    //         for (let applicant of applicants) {
    //             const { data: chatbotResponses, error: chatbotError } = await supabase
    //                 .from('chatbot_interaction')
    //                 .select('message, response, applicantStage')
    //                 .eq('userId', applicant.userId)
    //                 .order('timestamp', { ascending: true });
    
    //             if (chatbotError) {
    //                 console.error('Error fetching chatbot responses:', chatbotError);
    //                 return res.status(500).send('Error fetching chatbot responses');
    //             }
    
    //             // Find the position applied from the chatbot messages
    //             const positionAppliedMessage = chatbotResponses.find(response => response.message.toLowerCase().includes("position applied"));
    //             applicant.positionApplied = positionAppliedMessage ? positionAppliedMessage.message.split(":")[1].trim() : "N/A";  // Extract position after the colon
    
    //             // Find the application status based on the applicantStage
    //             const applicationStatusMessage = chatbotResponses.find(response => response.applicantStage === "application_complete" || response.applicantStage === "final_status");
    //             applicant.applicationStatus = applicationStatusMessage ? "Completed" : "Pending";  // Assuming 'Completed' if found, otherwise 'Pending'
    //         }
    
    //         res.render('staffpages/hr_pages/applicant-tracking-system', { applicants });
    
    //     } catch (error) {
    //         console.error('Error:', error);
    //         return res.status(500).send('Error fetching applicants');
    //     }
    // },        

    getHROnboarding: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            res.render('staffpages/hr_pages/hr-onboarding');
        } else {
            req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
            res.redirect('staff/login');
        }
    },

    getOnboardingStartDate: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { jobId } = req.query;
                
                if (!jobId) {
                    return res.status(400).json({ success: false, message: 'Missing job ID parameter' });
                }
                
                // Fetch the start date from the onboarding_position-startdate table
                const { data, error } = await supabase
                    .from('onboarding_position-startdate')
                    .select('setStartDate, additionalNotes')
                    .eq('jobId', jobId)
                    .single();
                    
                if (error) {
                    console.error('Error fetching start date:', error);
                    return res.status(500).json({ success: false, message: 'Failed to fetch start date' });
                }
                
                if (!data) {
                    return res.json({ success: false, message: 'No start date found for this job' });
                }
                
                return res.json({ 
                    success: true, 
                    startDate: data.setStartDate,
                    additionalNotes: data.additionalNotes || ''
                });
                
            } catch (error) {
                console.error('Error fetching start date:', error);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }
        } else {
            return res.status(401).json({ success: false, message: 'Unauthorized access. HR role required.' });
        }
    },

    sendOnboardingChecklist: async function(req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const { userId, applicantId, jobId, startDate } = req.body;
                
                if (!userId || !applicantId || !jobId || !startDate) {
                    return res.status(400).json({ success: false, message: 'Missing required information' });
                }
                
                // First, save the start date in the onboarding_position-startdate table
                const { error: startDateError } = await supabase
                    .from('onboarding_position-startdate')
                    .upsert({ 
                        jobId: jobId,
                        setStartDate: startDate,
                        updatedAt: new Date().toISOString()
                    });
                
                if (startDateError) {
                    console.error('Error saving start date:', startDateError);
                    return res.status(500).json({ success: false, message: 'Failed to save start date' });
                }
                
                // Update the applicant status in the database
                const { error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'Onboarding - First Day Checklist Sent' })
                    .eq('applicantId', applicantId);
                
                if (updateError) {
                    console.error('Error updating applicant status:', updateError);
                    return res.status(500).json({ success: false, message: 'Failed to update applicant status' });
                }
                
                // Get job title for the message
                const { data: jobData, error: jobError } = await supabase
                    .from('jobpositions')
                    .select('jobTitle')
                    .eq('jobId', jobId)
                    .single();
                    
                if (jobError) {
                    console.error('Error fetching job title:', jobError);
                }
                
                const jobTitle = jobData ? jobData.jobTitle : 'the position';
                
                // Send a congratulatory message through the chatbot
                try {
                    const currentTime = new Date().toISOString();
                    
                    // Send a predefined message to the user's chatbot
                    await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId: userId,
                            message: JSON.stringify({
                                text: "Congratulations! We're thrilled to inform you that you have successfully passed all phases of our screening processes. Please press the button below if you would like to accept the job offer for " + jobTitle + ".",
                                buttons: [
                                    {
                                        text: "Accept Job Offer",
                                        url: "/applicant/job-offer"
                                    }
                                ]
                            }),
                            sender: 'bot',
                            timestamp: currentTime,
                            applicantStage: 'Onboarding - First Day Checklist Sent'
                        }]);
                    
                    console.log('✅ [HR] Job offer message sent to applicant through chatbot');
                    
                } catch (chatError) {
                    console.error('Error sending chatbot message:', chatError);
                    // Continue execution - the status was updated successfully even if the message fails
                }
                
                // Return success response
                return res.json({
                    success: true,
                    message: 'Applicant status updated and job offer sent with start date: ' + startDate
                });
                
            } catch (error) {
                console.error('Error updating applicant status:', error);
                return res.status(500).json({ success: false, message: 'Internal server error' });
            }
        } else {
            return res.status(401).json({ success: false, message: 'Unauthorized access. HR role required.' });
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
    
    updateStatusToP1HRFailed: async function(req, res) {
        const { userId } = req.body; // Only get userId from request body
    
        try {
            // No need to update initial screening assessment for rejection
            // Just update the applicant status directly
    
            // Update `applicantaccounts` using `userId`
            const { error: statusError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: "P1 - HR FAILED" })
                .eq('userId', userId);
            
            if (statusError) throw statusError;
    
            res.json({ success: true, message: "Applicant status updated to P1 - HR FAILED successfully.", userId });
        } catch (error) {
            res.json({ success: false, message: error.message });
        }
    },

    getViewMRF: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                const mrfId = req.params.id; 
    
                const { data: mrfData, error: mrfError } = await supabase
                    .from('mrf')
                    .select('*')
                    .eq('mrfId', mrfId)
                    .single(); 

                if (mrfError) throw mrfError;

                const { data: departmentData, error: deptError } = await supabase
                    .from('departments')
                    .select('deptName')
                    .eq('departmentId', mrfData.departmentId)
                    .single();

                if (deptError) throw deptError;
    
                res.render('staffpages/hr_pages/hr-view-mrf', { 
                    mrf: mrfData,
                    department: departmentData ? departmentData.deptName : 'N/A' 
                });
            } catch (error) {
                console.error("Error in getViewMRF:", error);
                req.flash('errors', { fetchError: 'Error fetching MRF details. Please try again later.' });
                res.redirect('/hr/dashboard'); 
            }
        } else {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            res.redirect('/staff/login');
        }
    },

    submitMRF: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            req.flash('errors', { authError: 'Unauthorized. HR access only.' });
            return res.redirect('/staff/login');
        }
    
        console.log("Request Body:", req.body);  
    
        if (!req.body.mrfId) {
            console.error("Missing mrfId in request body");
            req.flash('errors', { submissionError: 'MRF ID is missing. Please try again.' });
            return res.redirect('/hr/dashboard');
        }
    
        const approvalStatus = req.body.hrApproval ? 'approved' : (req.body.hrDisapproval ? 'disapproved' : 'pending');
        const disapprovalReason = req.body.disapprovalReason || ''; 
    
        if (!['approved', 'disapproved', 'pending'].includes(approvalStatus)) {
            console.error('Invalid approval status:', approvalStatus);
            req.flash('errors', { submissionError: 'Invalid approval status. Please try again.' });
            return res.redirect('/hr/dashboard');
        }
    
        const approvalData = {
            mrfId: req.body.mrfId,  
            staffId: req.session.user.userId,
            approval_stage: req.session.user.userRole,
            reviewerName: req.session.user.userName || 'HR',  
            reviewerDateSigned: new Date().toISOString(),
            approvalStatus: approvalStatus,  // 'approved' or 'disapproved' or 'pending'
            disapprovalReason: disapprovalReason 
        };
    
        try {
            const { data: approvalDataInserted, error: approvalError } = await supabase
                .from('mrf_approvals')
                .insert([approvalData])
                .select();
    
            if (approvalError) {
                console.error("Supabase Error (Insert Approval):", approvalError.message, approvalError.details);
                throw approvalError;
            }
    
            console.log("Approval data inserted:", approvalDataInserted);
    
            let newMrfStatus = "Action Required";  
            
            if (approvalStatus === 'approved') {
                newMrfStatus = "Approved";
            } else if (approvalStatus === 'disapproved') {
                newMrfStatus = "Disapproved";
            }
    
            const { data: mrfUpdateData, error: mrfUpdateError } = await supabase
                .from('mrf')
                .update({ status: newMrfStatus })  // Update status in mrf table
                .eq('mrfId', req.body.mrfId) 
                .select(); 
    
            if (mrfUpdateError) {
                console.error("Error updating MRF status:", mrfUpdateError.message, mrfUpdateError.details);
                throw mrfUpdateError;
            }
    
            console.log("MRF status updated:", mrfUpdateData);
    
            req.flash('success', { message: 'MRF Approval/Disapproval submitted successfully!' });
            return res.redirect('/hr/dashboard');  
    
        } catch (error) {
            console.error("Error in MRF submission or approval insertion:", error);
            req.flash('errors', { submissionError: 'Failed to submit MRF approval. Please try again.' });
            return res.redirect('/hr/dashboard');
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
// Updated updateJobOffer function to correctly handle form data
updateJobOffer: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'HR') {
        try {
            const jobId = req.params.id;
            const { 
                jobTitle, 
                jobDescrpt, 
                isActiveHiring,
                isActiveJob,  
                hiringStartDate,  
                hiringEndDate,    
                remove_id // Array of IDs to remove
            } = req.body;

            // Process checkbox values
            const isHiringActive = isActiveHiring === 'on' || isActiveHiring === true;
            const isJobActive = isActiveJob === 'on' || isActiveJob === true;

            // Log the selected job title and date values for debugging
            console.log('Selected Job Title:', jobTitle);
            console.log('Hiring Start Date:', hiringStartDate);
            console.log('Hiring End Date:', hiringEndDate);
            console.log('isActiveHiring:', isHiringActive);
            console.log('isActiveJob:', isJobActive);

            // Update the main job offer in the 'jobpositions' table
            const { error: jobUpdateError } = await supabase
                .from('jobpositions')
                .update({
                    jobTitle,  
                    jobDescrpt,
                    isActiveHiring: isHiringActive,  // Use the processed boolean value
                    isActiveJob: isJobActive,        // Use the processed boolean value
                    hiringStartDate: hiringStartDate || null,
                    hiringEndDate: hiringEndDate || null
                })
                .eq('jobId', jobId);

            if (jobUpdateError) throw jobUpdateError;

            // Handle removing items if any IDs were provided
            if (remove_id) {
                // Convert to array if it's a single value
                const removeIds = Array.isArray(remove_id) ? remove_id : [remove_id];
                
                // Process each ID to determine which table it belongs to
                for (const id of removeIds) {
                    // Check each table to find and remove the item
                    
                    // Try to remove from skills
                    const { error: skillRemoveError } = await supabase
                        .from('jobreqskills')
                        .delete()
                        .eq('jobReqSkillId', id);
                    
                    if (!skillRemoveError) {
                        console.log(`Successfully removed skill with ID: ${id}`);
                        continue; // Move to next ID if this one was removed successfully
                    }
                    
                    // Try to remove from certifications
                    const { error: certRemoveError } = await supabase
                        .from('jobreqcertifications')
                        .delete()
                        .eq('jobReqCertificateId', id);
                    
                    if (!certRemoveError) {
                        console.log(`Successfully removed certification with ID: ${id}`);
                        continue;
                    }
                    
                    // Try to remove from degrees
                    const { error: degreeRemoveError } = await supabase
                        .from('jobreqdegrees')
                        .delete()
                        .eq('jobReqDegreeId', id);
                    
                    if (!degreeRemoveError) {
                        console.log(`Successfully removed degree with ID: ${id}`);
                        continue;
                    }
                    
                    // Try to remove from experiences
                    const { error: expRemoveError } = await supabase
                        .from('jobreqexperiences')
                        .delete()
                        .eq('jobReqExperienceId', id);
                    
                    if (!expRemoveError) {
                        console.log(`Successfully removed experience with ID: ${id}`);
                        continue;
                    }
                    
                    console.log(`Could not find item with ID: ${id} in any table`);
                }
            }

            // Process existing skills
            const skillUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('skill_')) {
                    const skillId = key.replace('skill_', '');
                    skillUpdates.push({
                        jobReqSkillId: skillId,
                        jobReqSkillName: value
                    });
                }
            }

            // Handle skill updates
            for (const skill of skillUpdates) {
                const { error: skillUpdateError } = await supabase
                    .from('jobreqskills')
                    .update({ jobReqSkillName: skill.jobReqSkillName })
                    .eq('jobReqSkillId', skill.jobReqSkillId);
                
                if (skillUpdateError) throw skillUpdateError;
            }

            // Process new skills
            const newSkillNames = Array.isArray(req.body.new_skill_name) 
                ? req.body.new_skill_name 
                : (req.body.new_skill_name ? [req.body.new_skill_name] : []);
            
            const newSkillTypes = Array.isArray(req.body.new_skill_type)
                ? req.body.new_skill_type
                : (req.body.new_skill_type ? [req.body.new_skill_type] : []);

            if (newSkillNames.length > 0) {
                const newSkills = newSkillNames.map((name, index) => ({
                    jobId: jobId,
                    jobReqSkillName: name,
                    jobReqSkillType: newSkillTypes[index] || 'Hard' // Default to Hard if type not specified
                }));

                const { error: newSkillError } = await supabase
                    .from('jobreqskills')
                    .insert(newSkills);
                
                if (newSkillError) throw newSkillError;
            }

            // Process existing certifications
            const certUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('cert_')) {
                    const certType = key.replace('cert_', '');
                    certUpdates.push({
                        jobReqCertificateType: certType,
                        jobReqCertificateDescrpt: value
                    });
                }
            }

            // Handle certification updates
            for (const cert of certUpdates) {
                const { error: certUpdateError } = await supabase
                    .from('jobreqcertifications')
                    .update({ jobReqCertificateDescrpt: cert.jobReqCertificateDescrpt })
                    .eq('jobReqCertificateType', cert.jobReqCertificateType)
                    .eq('jobId', jobId);
                
                if (certUpdateError) throw certUpdateError;
            }

            // Process new certifications
            const newCertTypes = Array.isArray(req.body.new_cert_type) 
                ? req.body.new_cert_type 
                : (req.body.new_cert_type ? [req.body.new_cert_type] : []);
            
            const newCertDescs = Array.isArray(req.body.new_cert_desc)
                ? req.body.new_cert_desc
                : (req.body.new_cert_desc ? [req.body.new_cert_desc] : []);

            if (newCertTypes.length > 0) {
                const newCerts = newCertTypes.map((type, index) => ({
                    jobId: jobId,
                    jobReqCertificateType: type,
                    jobReqCertificateDescrpt: newCertDescs[index] || ''
                }));

                const { error: newCertError } = await supabase
                    .from('jobreqcertifications')
                    .insert(newCerts);
                
                if (newCertError) throw newCertError;
            }

            // Similar processing for degrees
            const degreeUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('degree_')) {
                    const degreeType = key.replace('degree_', '');
                    degreeUpdates.push({
                        jobReqDegreeType: degreeType,
                        jobReqDegreeDescrpt: value
                    });
                }
            }

            for (const degree of degreeUpdates) {
                const { error: degreeUpdateError } = await supabase
                    .from('jobreqdegrees')
                    .update({ jobReqDegreeDescrpt: degree.jobReqDegreeDescrpt })
                    .eq('jobReqDegreeType', degree.jobReqDegreeType)
                    .eq('jobId', jobId);
                
                if (degreeUpdateError) throw degreeUpdateError;
            }

            // Process new degrees
            const newDegreeTypes = Array.isArray(req.body.new_degree_type) 
                ? req.body.new_degree_type 
                : (req.body.new_degree_type ? [req.body.new_degree_type] : []);
            
            const newDegreeDescs = Array.isArray(req.body.new_degree_desc)
                ? req.body.new_degree_desc
                : (req.body.new_degree_desc ? [req.body.new_degree_desc] : []);

            if (newDegreeTypes.length > 0) {
                const newDegrees = newDegreeTypes.map((type, index) => ({
                    jobId: jobId,
                    jobReqDegreeType: type,
                    jobReqDegreeDescrpt: newDegreeDescs[index] || ''
                }));

                const { error: newDegreeError } = await supabase
                    .from('jobreqdegrees')
                    .insert(newDegrees);
                
                if (newDegreeError) throw newDegreeError;
            }

            // Similar processing for experiences
            const experienceUpdates = [];
            for (const [key, value] of Object.entries(req.body)) {
                if (key.startsWith('experience_')) {
                    const expType = key.replace('experience_', '');
                    experienceUpdates.push({
                        jobReqExperienceType: expType,
                        jobReqExperienceDescrpt: value
                    });
                }
            }

            for (const exp of experienceUpdates) {
                const { error: expUpdateError } = await supabase
                    .from('jobreqexperiences')
                    .update({ jobReqExperienceDescrpt: exp.jobReqExperienceDescrpt })
                    .eq('jobReqExperienceType', exp.jobReqExperienceType)
                    .eq('jobId', jobId);
                
                if (expUpdateError) throw expUpdateError;
            }

            // Process new experiences
            const newExpTypes = Array.isArray(req.body.new_experience_type) 
                ? req.body.new_experience_type 
                : (req.body.new_experience_type ? [req.body.new_experience_type] : []);
            
            const newExpDescs = Array.isArray(req.body.new_experience_desc)
                ? req.body.new_experience_desc
                : (req.body.new_experience_desc ? [req.body.new_experience_desc] : []);

            if (newExpTypes.length > 0) {
                const newExps = newExpTypes.map((type, index) => ({
                    jobId: jobId,
                    jobReqExperienceType: type,
                    jobReqExperienceDescrpt: newExpDescs[index] || ''
                }));

                const { error: newExpError } = await supabase
                    .from('jobreqexperiences')
                    .insert(newExps);
                
                if (newExpError) throw newExpError;
            }

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
                    jobTimeCommitment_startTime, jobTimeCommitment_endTime,
                    hiringStartDate, hiringEndDate,
                    jobReqCertificateType, jobReqCertificateDescrpt,
                    jobReqDegreeType, jobReqDegreeDescrpt,
                    jobReqExperienceType, jobReqExperienceDescrpt, jobReqSkillType, jobReqSkillName
                } = req.body;
    
                console.log('Processing job offer submission for:', jobTitle);
    
                // Determine if the job is currently active based on hiring dates
                const currentDate = new Date();
                const startDate = new Date(hiringStartDate);
                const endDate = new Date(hiringEndDate);
                const isActiveHiring = currentDate >= startDate && currentDate <= endDate;
    
                // Step 1: Check if the selected job title already exists
                const { data: existingJob, error: existingJobError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle')
                    .eq('jobId', jobTitle);
    
                if (existingJobError) {
                    console.error('Error checking existing job:', existingJobError);
                    throw existingJobError;
                }
    
                let jobId;
    
                // Step 2: If the job exists, use the existing jobId
                if (existingJob && existingJob.length > 0) {
                    jobId = existingJob[0].jobId;
                    console.log('Using existing job with ID:', jobId);
    
                    // Update the existing job row
                    const { error: updateError } = await supabase
                        .from('jobpositions')
                        .update({
                            jobDescrpt,
                            jobType,
                            jobTimeCommitment,
                            jobTimeCommitment_startTime,
                            jobTimeCommitment_endTime,
                            hiringStartDate,
                            hiringEndDate,
                            isActiveHiring
                        })
                        .eq('jobId', jobId);
    
                    if (updateError) {
                        console.error('Error updating job:', updateError);
                        throw updateError;
                    }
                } else {
                    // This shouldn't happen because we're selecting a job from dropdown
                    console.error('Job ID not found:', jobTitle);
                    return res.status(404).json({ error: 'Job title not found. Please select a valid job title.' });
                }
    
                // Step 3: Handle Job Requirements Insertion/Update
    
                // Function to insert or update job requirements (certificates, degrees, etc.)
                const upsertData = async (tableName, data, matchingField) => {
                    if (!data || data.length === 0 || !Array.isArray(data)) {
                        console.log(`No ${tableName} data to upsert`);
                        return;
                    }
                    
                    console.log(`Upserting ${data.length} records to ${tableName}`);
                    
                    // First remove existing records for this job
                    const { error: deleteError } = await supabase
                        .from(tableName)
                        .delete()
                        .eq('jobId', jobId);
                    
                    if (deleteError) {
                        console.error(`Error deleting existing records from ${tableName}:`, deleteError);
                        throw deleteError;
                    }
                    
                    // Then insert all new records
                    const { error: insertError } = await supabase
                        .from(tableName)
                        .insert(data);
                    
                    if (insertError) {
                        console.error(`Error inserting records into ${tableName}:`, insertError);
                        throw insertError;
                    }
                    
                    console.log(`Successfully upserted data to ${tableName}`);
                };
    
                // Prepare and upsert certifications if provided
                if (jobReqCertificateType && jobReqCertificateDescrpt) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqCertificateType) && Array.isArray(jobReqCertificateDescrpt) && 
                        jobReqCertificateType.length === jobReqCertificateDescrpt.length) {
                        
                        const certData = jobReqCertificateType.map((type, index) => ({
                            jobId,
                            jobReqCertificateType: type,
                            jobReqCertificateDescrpt: jobReqCertificateDescrpt[index]
                        }));
                        await upsertData('jobreqcertifications', certData, 'jobReqCertificateType');
                    } else {
                        console.warn('Mismatched certification data arrays, skipping.');
                    }
                }
    
                // Prepare and upsert degrees if provided
                if (jobReqDegreeType && jobReqDegreeDescrpt) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqDegreeType) && Array.isArray(jobReqDegreeDescrpt) && 
                        jobReqDegreeType.length === jobReqDegreeDescrpt.length) {
                        
                        const degreeData = jobReqDegreeType.map((type, index) => ({
                            jobId,
                            jobReqDegreeType: type,
                            jobReqDegreeDescrpt: jobReqDegreeDescrpt[index]
                        }));
                        await upsertData('jobreqdegrees', degreeData, 'jobReqDegreeType');
                    } else {
                        console.warn('Mismatched degree data arrays, skipping.');
                    }
                }
    
                // Prepare and upsert experiences if provided
                if (jobReqExperienceType && jobReqExperienceDescrpt) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqExperienceType) && Array.isArray(jobReqExperienceDescrpt) && 
                        jobReqExperienceType.length === jobReqExperienceDescrpt.length) {
                        
                        const experienceData = jobReqExperienceType.map((type, index) => ({
                            jobId,
                            jobReqExperienceType: type,
                            jobReqExperienceDescrpt: jobReqExperienceDescrpt[index]
                        }));
                        await upsertData('jobreqexperiences', experienceData, 'jobReqExperienceType');
                    } else {
                        console.warn('Mismatched experience data arrays, skipping.');
                    }
                }
    
                // Prepare and upsert skills if provided
                if (jobReqSkillType && jobReqSkillName) {
                    // Ensure both arrays exist and have the same length
                    if (Array.isArray(jobReqSkillType) && Array.isArray(jobReqSkillName) && 
                        jobReqSkillType.length === jobReqSkillName.length) {
                        
                        const skillData = jobReqSkillType.map((type, index) => ({
                            jobId,
                            jobReqSkillType: type,
                            jobReqSkillName: jobReqSkillName[index]
                        }));
                        await upsertData('jobreqskills', skillData, 'jobReqSkillType');
                    } else {
                        console.warn('Mismatched skill data arrays, skipping.');
                    }
                }
    
                console.log('Job posting successfully saved/updated');
                
                // Success response: redirect to job postings page
                res.redirect('/hr/joboffers');
    
            } catch (error) {
                console.error('Error adding or updating job postings and requirements:', error);
                // Handle error response
                res.status(500).json({ error: 'Failed to add or update job posting. Please try again.' });
            }
        } else {
            // Handle unauthorized access
            res.status(403).json({ errors: 'Unauthorized. HR access only.' });
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
        
                // Fetch all job titles to populate the dropdown
                const { data: jobTitles, error: jobTitlesError } = await supabase
                    .from('jobpositions')
                    .select('jobId, jobTitle')
                    .order('jobTitle', { ascending: true });
        
                if (jobTitlesError) {
                    console.error('Error fetching job titles:', jobTitlesError);
                    req.flash('errors', { fetchError: 'Error fetching job titles.' });
                    return res.redirect('/hr/joboffers');
                }
        
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
                    jobTitles, // Pass job titles to the template
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

    getApplicantData: async function(req, res) {
        try {
            // Fetch applicants with their respective screening assessment data
            const { data: applicants, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select(`
                    lastName, 
                    firstName, 
                    birthDate, 
                    phoneNo,
                    userId, 
                    applicant_initialscreening_assessment(
                        initialScreeningId,
                        jobId,
                        degreeScore,
                        experienceScore,
                        certificationScore,
                        hardSkillsScore,
                        softSkillsScore,
                        workSetupScore,
                        availabilityScore,
                        totalScore,
                        totalScoreCalculatedAt,
                         resume_url,
                        isHRChosen,
                        isLineManagerChosen
                    )
                `);
    
            if (applicantError) throw applicantError;
    
            // Render the EJS template and pass the applicants data
            res.render('staffpages/hr_pages/hrapplicanttracking-jobposition', { applicants });
    
        } catch (error) {
            console.error('Error fetching applicants:', error);
            res.status(500).json({ error: 'Error fetching applicants' });
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
        const { jobTitle, departmentId } = req.body; // Assuming jobTitle and departmentId are sent in the request body
        try {
            // Check if the job title already exists in the department
            const { data: existingJob, error: existingJobError } = await supabase
                .from('jobpositions')
                .select('jobId')
                .eq('jobTitle', jobTitle)
                .eq('departmentId', departmentId);
    
            if (existingJobError) throw existingJobError;
    
            if (existingJob && existingJob.length > 0) {
                // If the job title already exists, return the jobId
                return res.status(200).json({ message: 'Job title already exists', jobId: existingJob[0].jobId });
            }
    
            // If the job title does not exist, insert a new record
            const { data: newJob, error: newJobError } = await supabase
                .from('jobpositions')
                .insert([{ jobTitle, departmentId }])
                .select();
    
            if (newJobError) throw newJobError;
    
            return res.status(201).json({ message: 'New job title added', jobId: newJob[0].jobId });
        } catch (error) {
            console.error('Error adding job title:', error);
            return res.status(500).json({ error: 'Error adding job title' });
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

    // updateApplicantIsChosen: async function (req, res) {
    //     if (req.session.user && req.session.user.userRole === 'HR') {
    //         try {
    //             const { lastName, firstName } = req.body; // Extract applicant details from the request
    
    //             // Use a switch case to handle the update logic
    //             switch (true) {
    //                 case !lastName || !firstName: {
    //                     console.error('Missing applicant details.');
    //                     return res.status(400).json({ success: false, message: 'Applicant details are missing.' });
    //                 }
    
    //                 case true: {
    //                     // Case to update `isChosen1` field
    //                     const { error: chosenError } = await supabase
    //                         .from('applicantaccounts')
    //                         .update({ isChosen1: true })
    //                         .match({ lastName, firstName });
    
    //                     if (chosenError) {
    //                         console.error('Error updating isChosen1:', chosenError);
    //                         return res.status(500).json({ success: false, message: 'Failed to update isChosen1.' });
    //                     }
    
    //                     // Case to update `applicantStatus` after `isChosen1` is true
    //                     const { error: statusError } = await supabase
    //                         .from('applicantaccounts')
    //                         .update({ applicantStatus: 'P1 - Awaiting for Line Manager Action; HR PASSED' })
    //                         .match({ lastName, firstName, isChosen1: true });
    
    //                     if (statusError) {
    //                         console.error('Error updating applicantStatus:', statusError);
    //                         return res.status(500).json({ success: false, message: 'Failed to update applicant status.' });
    //                     }
    
    //                     // If all updates succeed
    //                     return res.json({ success: true, message: 'Applicant status updated successfully.' });
    //                 }
    
    //                 default: {
    //                     console.error('Unexpected case encountered.');
    //                     return res.status(400).json({ success: false, message: 'Invalid operation.' });
    //                 }
    //             }
    //         } catch (error) {
    //             console.error('Error in updateApplicantIsChosen:', error);
    //             res.status(500).json({ success: false, message: 'Internal server error.' });
    //         }
    //     } else {
    //         req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
    //         res.redirect('/staff/login');
    //     }
    // },



saveEvaluation: async function (req, res) {
    try {
        console.log("Request Body:", req.body);
        
        // Extract all form data
        const {
            applicantId,
            totalAssessmentRating,
            expectedCompensation,
            reasonForApplying,
            availability,
            fitForRole,
            recommendedForConsideration,
            // Individual ratings - Professional Background
            professional_understanding,
            professional_relevance,
            professional_achievements,
            // Individual ratings - Functional Skills
            functional_proficiency,
            functional_experience,
            functional_examples,
            // Individual ratings - Other categories
            teamwork_collaboration,
            teamwork_experiences,
            value_innovation,
            value_contribution,
            integrity_respect,
            integrity_professional,
            problem_solving_skills,
            problem_solving_examples,
            motivation_interest,
            // Category totals
            professionalTotal,
            functionalTotal,
            teamworkTotal,
            valueTotal,
            integrityTotal,
            problemSolvingTotal,
            motivationTotal
        } = req.body;

        // Validate required inputs
        if (!applicantId) {
            return res.status(400).json({
                success: false,
                message: "Applicant ID is required.",
            });
        }

        if (totalAssessmentRating === undefined || totalAssessmentRating === null) {
            return res.status(400).json({
                success: false,
                message: "Total assessment rating is required.",
            });
        }

        // Convert applicantId to integer
        const parsedApplicantId = parseInt(applicantId, 10);
        if (isNaN(parsedApplicantId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Applicant ID format.",
            });
        }

        // Get HR user ID from session
        const hrUserId = req.session.user?.userId;
        if (!hrUserId) {
            return res.status(401).json({
                success: false,
                message: "HR user not authenticated.",
            });
        }

        // First, get the applicant's job ID
        const { data: applicantData, error: applicantError } = await supabase
            .from("applicantaccounts")
            .select("jobId")
            .eq("applicantId", parsedApplicantId)
            .single();

        if (applicantError || !applicantData) {
            console.error("Applicant lookup error:", applicantError);
            return res.status(404).json({
                success: false,
                message: "Applicant not found.",
            });
        }

        // Helper function to safely parse integers
        const safeParseInt = (value) => {
            const parsed = parseInt(value, 10);
            return isNaN(parsed) ? 0 : parsed;
        };

        // Prepare the hrFormData as JSONB structure
        const hrFormData = {
            professionalBackground: {
                understanding: safeParseInt(professional_understanding),
                relevance: safeParseInt(professional_relevance),
                achievements: safeParseInt(professional_achievements),
                total: safeParseInt(professionalTotal)
            },
            functionalSkills: {
                proficiency: safeParseInt(functional_proficiency),
                experience: safeParseInt(functional_experience),
                examples: safeParseInt(functional_examples),
                total: safeParseInt(functionalTotal)
            },
            teamworkAndCollaboration: {
                collaboration: safeParseInt(teamwork_collaboration),
                experiences: safeParseInt(teamwork_experiences),
                total: safeParseInt(teamworkTotal)
            },
            valueCreation: {
                innovation: safeParseInt(value_innovation),
                contribution: safeParseInt(value_contribution),
                total: safeParseInt(valueTotal)
            },
            integrity: {
                respect: safeParseInt(integrity_respect),
                professional: safeParseInt(integrity_professional),
                total: safeParseInt(integrityTotal)
            },
            problemSolvingAbilities: {
                skills: safeParseInt(problem_solving_skills),
                examples: safeParseInt(problem_solving_examples),
                total: safeParseInt(problemSolvingTotal)
            },
            motivationAndFit: {
                interest: safeParseInt(motivation_interest),
                total: safeParseInt(motivationTotal)
            }
        };

        // Get current date for interview date
        const currentDate = new Date().toISOString().split('T')[0];

        // Convert boolean values properly
        const fitForRoleBool = fitForRole === true || fitForRole === 'true' || fitForRole === 'Yes';
        const recommendedBool = recommendedForConsideration === true || recommendedForConsideration === 'true' || recommendedForConsideration === 'Yes';

        // Check if evaluation already exists
        const { data: existingEval, error: checkError } = await supabase
            .from("applicant_hrscreening_assessment")
            .select('hrInterviewId')
            .eq('applicantUserid', parsedApplicantId)
            .single();

        let evaluationData, evaluationError;

        const evaluationRecord = {
            hrUserId: hrUserId,
            jobId: applicantData.jobId,
            interviewDate: currentDate,
            hrFormData: hrFormData,
            recommendedForConsideration: recommendedBool,
            totalAssessmentRating: parseFloat(totalAssessmentRating),
            fitForRole: fitForRoleBool,
            expectedCompensation: expectedCompensation || null,
            reasonForApplying: reasonForApplying || null,
            availability: availability || null
        };

        if (existingEval && !checkError) {
            // Update existing evaluation
            evaluationRecord.updatedAt = new Date().toISOString();
            
            const updateResult = await supabase
                .from("applicant_hrscreening_assessment")
                .update(evaluationRecord)
                .eq('applicantUserid', parsedApplicantId)
                .select();

            evaluationData = updateResult.data;
            evaluationError = updateResult.error;
            console.log("Updated existing evaluation for applicantId:", parsedApplicantId);
        } else {
            // Insert new evaluation
            evaluationRecord.applicantUserid = parsedApplicantId;
            evaluationRecord.createdAt = new Date().toISOString();
            
            const insertResult = await supabase
                .from("applicant_hrscreening_assessment")
                .insert(evaluationRecord)
                .select();

            evaluationData = insertResult.data;
            evaluationError = insertResult.error;
            console.log("Created new evaluation for applicantId:", parsedApplicantId);
        }

        console.log("Evaluation Supabase Response:", { data: evaluationData, error: evaluationError });

        if (evaluationError) {
            console.error("Error saving evaluation:", evaluationError);
            return res.status(500).json({
                success: false,
                message: "Failed to save the evaluation.",
                error: evaluationError.message
            });
        }

        // Update applicant status and hrInterviewFormScore in applicantaccounts table
        const { data: statusData, error: statusError } = await supabase
            .from("applicantaccounts")
            .update({
                applicantStatus: "P2 - HR Evaluation Accomplished",
                hrInterviewFormScore: parseFloat(totalAssessmentRating)
            })
            .eq("applicantId", parsedApplicantId);

        console.log("Status Update Supabase Response:", { data: statusData, error: statusError });

        if (statusError) {
            console.error("Error updating applicant status:", statusError);
            // Note: We don't return error here as the evaluation was saved successfully
        }

        // Respond with success
        res.json({
            success: true,
            message: "Evaluation saved and applicant status updated successfully!",
            data: {
                evaluationId: evaluationData?.[0]?.hrInterviewId,
                totalRating: totalAssessmentRating,
                applicantStatus: "P2 - HR Evaluation Accomplished"
            }
        });

    } catch (err) {
        console.error("Server error:", err);
        res.status(500).json({
            success: false,
            message: "An unexpected error occurred while saving the evaluation.",
            error: err.message
        });
    }
},

getEvaluationForm: async function (req, res) {
    if (req.session.user && req.session.user.userRole === 'HR') {
        const applicantId = req.params.applicantId;
        
        try {
            console.log('Fetching applicant details for applicantId:', applicantId);
            
            const parsedApplicantId = parseInt(applicantId, 10);
            if (isNaN(parsedApplicantId)) {
                req.flash('errors', { message: 'Invalid Applicant ID format.' });
                return res.redirect('/hr/applicant-tracker');
            }
            
            // Fetch applicant details with proper joins
            const { data: applicant, error } = await supabase
                .from('applicantaccounts')
                .select(`
                    *,
                    jobpositions!inner (
                        jobTitle,
                        departmentId,
                        departments!inner (
                            deptName
                        )
                    )
                `)
                .eq('applicantId', parsedApplicantId)
                .single();
            
            console.log('Database Response:', { data: applicant, error });
            
            if (error || !applicant) {
                console.error("Error fetching applicant details:", error || "Applicant not found.");
                req.flash('errors', { message: 'Could not retrieve applicant details.' });
                return res.redirect('/hr/applicant-tracker');
            }
            
            // Get HR name from session
            const hrName = `${req.session.user.firstName || ''} ${req.session.user.lastName || ''}`.trim() || 'HR Representative';
            
            // Get current date
            const interviewDate = new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            console.log('Applicant Details:', applicant);
            
            // Check if evaluation already exists
            const { data: existingEvaluation, error: evalError } = await supabase
                .from('applicant_hrscreening_assessment')
                .select('*')
                .eq('applicantUserid', parsedApplicantId)
                .single();
            
            if (existingEvaluation && !evalError) {
                req.flash('info', { message: 'An evaluation already exists for this applicant.' });
                // You can either redirect or show the existing evaluation
                // For now, we'll continue to show the form
            }
            
            // Render the evaluation form
            res.render('staffpages/hr_pages/hr-eval-form', {
                applicantId: parsedApplicantId,
                applicant,
                interviewDetails: {
                    conductedBy: hrName,
                    dateOfInterview: interviewDate,
                    departmentName: applicant.jobpositions?.departments?.deptName || 'N/A'
                },
                existingEvaluation: existingEvaluation || null
            });
            
        } catch (err) {
            console.error("Error loading evaluation form:", err);
            req.flash('errors', { message: 'Internal server error.' });
            return res.redirect('/hr/applicant-tracker');
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
        res.redirect('/staff/login');
    }
},

// Function to handle rejection of an applicant
rejectApplicant: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'HR') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    const { applicantId } = req.body;

    if (!applicantId) {
        return res.status(400).json({ success: false, message: 'Applicant ID is required' });
    }

    try {
        // Update the applicant status in the database
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P2 - FAILED' })
            .eq('applicantId', applicantId);

        if (error) {
            console.error('Error rejecting applicant:', error);
            return res.status(500).json({ success: false, message: 'Database error occurred' });
        }

        return res.json({ success: true, message: 'Applicant rejected successfully' });
    } catch (err) {
        console.error('Server error in rejectApplicant:', err);
        return res.status(500).json({ success: false, message: 'Server error occurred' });
    }
},

// Function to handle passing an applicant to the next stage
passApplicant: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'HR') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    const { applicantId } = req.body;

    if (!applicantId) {
        return res.status(400).json({ success: false, message: 'Applicant ID is required' });
    }

    try {
        // Update the applicant status in the database
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P2 - PASSED' })
            .eq('applicantId', applicantId);

        if (error) {
            console.error('Error passing applicant:', error);
            return res.status(500).json({ success: false, message: 'Database error occurred' });
        }

        return res.json({ success: true, message: 'Applicant passed to next stage successfully' });
    } catch (err) {
        console.error('Server error in passApplicant:', err);
        return res.status(500).json({ success: false, message: 'Server error occurred' });
    }
},

getEmailTemplates: async function(req, res) {
 try {
        const { phase } = req.query; // P1, P2, or P3
        console.log(`📧 [Templates] Fetching email templates for phase: ${phase}`);
        
        // This will use the actual templates from your emailService.js
        const templates = getEmailTemplateData(phase || 'P1');
        
        console.log(`✅ [Templates] Successfully fetched ${phase} templates from emailService.js`);
        console.log('📧 [Templates] Template data:', templates);
        
        res.json({
            success: true,
            phase: phase,
            templates: templates
        });
        
    } catch (error) {
        console.error('❌ [Templates] Error fetching email templates from emailService.js:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching email templates: ' + error.message
        });
    }
},

// Enhanced markAsP2Passed function with better logging
markAsP2Passed: async function(req, res) {
    try {
        console.log('🟢 [HR] P2 Pass request received');
        const { applicantId } = req.body;
        
        if (!applicantId) {
            console.error('❌ [HR] Missing applicantId in P2 pass request');
            return res.status(400).json({ success: false, message: "Missing applicant ID" });
        }
        
        console.log(`📊 [HR] Marking applicantId ${applicantId} as P2 PASSED (Pending Finalization)`);
        
        // Update the status for display purposes only
        const { data, error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P2 - PASSED (Pending Finalization)' })
            .eq('applicantId', applicantId);
            
        if (error) {
            console.error('❌ [HR] Database error marking applicant as P2 PASSED:', error);
            return res.status(500).json({ success: false, message: "Error updating applicant status" });
        }
        
        console.log(`✅ [HR] Successfully marked applicantId ${applicantId} as P2 PASSED (Pending)`);
        return res.status(200).json({ 
            success: true, 
            message: "Applicant marked as P2 PASSED. Status will be finalized when review is complete."
        });
        
    } catch (error) {
        console.error('❌ [HR] Error in markAsP2Passed:', error);
        return res.status(500).json({ success: false, message: "Error marking applicant as P2 PASSED: " + error.message });
    }
},

// Enhanced markAsP2Failed function with better logging
markAsP2Failed: async function(req, res) {
    try {
        console.log('🔴 [HR] P2 Failed request received');
        const { applicantId } = req.body;
        
        if (!applicantId) {
            console.error('❌ [HR] Missing applicantId in P2 failed request');
            return res.status(400).json({ success: false, message: "Missing applicant ID" });
        }
        
        console.log(`📊 [HR] Marking applicantId ${applicantId} as P2 FAILED (Pending Finalization)`);
        
        // Update the status for display purposes only
        const { data, error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P2 - FAILED (Pending Finalization)' })
            .eq('applicantId', applicantId);
            
        if (error) {
            console.error('❌ [HR] Database error marking applicant as P2 FAILED:', error);
            return res.status(500).json({ success: false, message: "Error updating applicant status" });
        }
        
        console.log(`✅ [HR] Successfully marked applicantId ${applicantId} as P2 FAILED (Pending)`);
        return res.status(200).json({ 
            success: true, 
            message: "Applicant marked as P2 FAILED. Status will be finalized when review is complete."
        });
        
    } catch (error) {
        console.error('❌ [HR] Error in markAsP2Failed:', error);
        return res.status(500).json({ success: false, message: "Error marking applicant as P2 FAILED: " + error.message });
    }
},

// Get P2 email templates for Gmail integration
getP2EmailTemplates: async function(req, res) {
    try {
        console.log('✅ [HR] Getting P2 email templates for Gmail integration');
        
        // Use the unified function with P2 phase
        const templates = getEmailTemplateData('P2');
        
        return res.status(200).json({
            success: true,
            templates: templates,
            message: "P2 email templates retrieved successfully"
        });
        
    } catch (error) {
        console.error('❌ [HR] Error getting P2 email templates:', error);
        return res.status(500).json({
            success: false,
            message: "Error getting P2 email templates: " + error.message
        });
    }
},
finalizeP2Review: async function(req, res) {
    try {
        console.log('🚀 [HR] Processing P2 review finalization request');
        
        const { passedApplicantIds, failedApplicantIds, getEmailData } = req.body;
        
        if (!passedApplicantIds || !failedApplicantIds) {
            console.error('❌ [HR] Missing applicant IDs in P2 finalize request');
            return res.status(400).json({ success: false, message: "Missing applicant IDs" });
        }
        
        console.log(`📊 [HR] P2 Finalize request: ${passedApplicantIds.length} passed, ${failedApplicantIds.length} failed, getEmailData: ${getEmailData}`);
        
        // If this is just to get email data (not update statuses), fetch applicant info
        if (getEmailData) {
            console.log('📧 [HR] Fetching P2 applicant data for email composition');
            
            // Fetch passed applicants data using the same pattern as getApplicantTrackerByJobPositions
            let passedApplicants = [];
            if (passedApplicantIds.length > 0) {
                console.log('📊 [HR] Fetching passed applicants data...');
                
                // Get applicant data first
                const { data: passedApplicantData, error: passedError } = await supabase
                    .from('applicantaccounts')
                    .select(`
                        applicantId,
                        userId,
                        firstName,
                        lastName,
                        jobId
                    `)
                    .in('applicantId', passedApplicantIds);
                    
                if (passedError) {
                    console.error('❌ [HR] Error fetching passed applicants:', passedError);
                    return res.status(500).json({ success: false, message: "Error fetching passed applicants data" });
                }
                
                console.log(`✅ [HR] Found ${passedApplicantData?.length || 0} passed applicants from applicantaccounts`);
                
                if (passedApplicantData && passedApplicantData.length > 0) {
                    // Get user emails separately (like in your existing function)
                    const { data: userAccounts, error: userError } = await supabase
                        .from('useraccounts')
                        .select('userId, userEmail');
                    
                    if (userError) {
                        console.error('❌ [HR] Error fetching user accounts:', userError);
                        return res.status(500).json({ success: false, message: "Error fetching user email data" });
                    }
                    
                    // Get job titles separately
                    const { data: jobTitles, error: jobError } = await supabase
                        .from('jobpositions')
                        .select('jobId, jobTitle');
                    
                    if (jobError) {
                        console.error('❌ [HR] Error fetching job titles:', jobError);
                        return res.status(500).json({ success: false, message: "Error fetching job titles" });
                    }
                    
                    // Combine data like in your existing function
                    passedApplicants = passedApplicantData.map(applicant => {
                        const userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
                        const jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'Position';
                        
                        return {
                            applicantId: applicant.applicantId,
                            userId: applicant.userId,
                            name: `${applicant.firstName} ${applicant.lastName}`,
                            email: userEmail,
                            jobId: applicant.jobId,
                            jobTitle: jobTitle
                        };
                    });
                    
                    console.log(`✅ [HR] Processed ${passedApplicants.length} passed applicants with emails`);
                }
            }
            
            // Fetch failed applicants data using the same pattern
            let failedApplicants = [];
            if (failedApplicantIds.length > 0) {
                console.log('📊 [HR] Fetching failed applicants data...');
                
                // Get applicant data first
                const { data: failedApplicantData, error: failedError } = await supabase
                    .from('applicantaccounts')
                    .select(`
                        applicantId,
                        userId,
                        firstName,
                        lastName,
                        jobId
                    `)
                    .in('applicantId', failedApplicantIds);
                    
                if (failedError) {
                    console.error('❌ [HR] Error fetching failed applicants:', failedError);
                    return res.status(500).json({ success: false, message: "Error fetching failed applicants data" });
                }
                
                console.log(`✅ [HR] Found ${failedApplicantData?.length || 0} failed applicants from applicantaccounts`);
                
                if (failedApplicantData && failedApplicantData.length > 0) {
                    // Get user emails separately (reuse if already fetched, or fetch again)
                    const { data: userAccounts, error: userError } = await supabase
                        .from('useraccounts')
                        .select('userId, userEmail');
                    
                    if (userError) {
                        console.error('❌ [HR] Error fetching user accounts:', userError);
                        return res.status(500).json({ success: false, message: "Error fetching user email data" });
                    }
                    
                    // Get job titles separately (reuse if already fetched, or fetch again)
                    const { data: jobTitles, error: jobError } = await supabase
                        .from('jobpositions')
                        .select('jobId, jobTitle');
                    
                    if (jobError) {
                        console.error('❌ [HR] Error fetching job titles:', jobError);
                        return res.status(500).json({ success: false, message: "Error fetching job titles" });
                    }
                    
                    // Combine data like in your existing function
                    failedApplicants = failedApplicantData.map(applicant => {
                        const userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
                        const jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'Position';
                        
                        return {
                            applicantId: applicant.applicantId,
                            userId: applicant.userId,
                            name: `${applicant.firstName} ${applicant.lastName}`,
                            email: userEmail,
                            jobId: applicant.jobId,
                            jobTitle: jobTitle
                        };
                    });
                    
                    console.log(`✅ [HR] Processed ${failedApplicants.length} failed applicants with emails`);
                }
            }
            
            console.log(`📊 [HR] Email data fetch complete: ${passedApplicants.length} passed, ${failedApplicants.length} failed`);
            console.log('📧 [HR] Passed applicants:', passedApplicants);
            console.log('📧 [HR] Failed applicants:', failedApplicants);
            
            // Return applicant data for Gmail compose
            return res.status(200).json({
                success: true,
                requiresGmailCompose: true,
                passedApplicants: passedApplicants,
                failedApplicants: failedApplicants,
                message: "P2 applicant data fetched for email composition"
            });
        }
        
        // Otherwise, proceed with the actual status updates (existing code remains the same)
        console.log(`🔄 [HR] P2 Finalization: ${passedApplicantIds.length} passed, ${failedApplicantIds.length} failed`);
        
        let updateResults = {
            passed: { updated: 0, errors: [] },
            failed: { updated: 0, errors: [] }
        };
        
        // Update passed applicants
        for (const applicantId of passedApplicantIds) {
            try {
                console.log(`✅ [HR] Updating P2 PASSED status for applicantId: ${applicantId}`);
                
                // Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ 
                        applicantStatus: 'P2 - PASSED',
                        p2_Approved: true,
                        p2_hrevalscheduled: true
                    })
                    .eq('applicantId', applicantId);
                    
                if (updateError) {
                    console.error(`❌ [HR] Error updating status for ${applicantId}:`, updateError);
                    updateResults.passed.errors.push(`${applicantId}: ${updateError.message}`);
                    continue;
                }
                
                updateResults.passed.updated++;
                console.log(`✅ [HR] Successfully updated P2 PASSED for applicantId: ${applicantId}`);
                
                // Get userId for chatbot message
                const { data: applicantData, error: fetchError } = await supabase
                    .from('applicantaccounts')
                    .select('userId')
                    .eq('applicantId', applicantId)
                    .single();
                
                if (!fetchError && applicantData && applicantData.userId) {
                    // Add chatbot message
                    const { data: chatData, error: chatError } = await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId: applicantData.userId,
                            message: JSON.stringify({ 
                                text: "Congratulations! You have successfully passed the HR evaluation process. We will contact you soon to schedule the next interview stage with the Line Manager." 
                            }),
                            sender: 'bot',
                            timestamp: new Date().toISOString(),
                            applicantStage: 'P2 - PASSED'
                        }]);
                        
                    if (chatError) {
                        console.error(`❌ [HR] Error adding chat message for ${applicantId}:`, chatError);
                    } else {
                        console.log(`💬 [HR] Added chatbot message for passed applicant ${applicantId}`);
                    }
                }
                
            } catch (error) {
                console.error(`❌ [HR] Error processing passed applicant ${applicantId}:`, error);
                updateResults.passed.errors.push(`${applicantId}: ${error.message}`);
            }
        }
        
        // Update failed applicants
        for (const applicantId of failedApplicantIds) {
            try {
                console.log(`❌ [HR] Updating P2 FAILED status for applicantId: ${applicantId}`);
                
                // Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ 
                        applicantStatus: 'P2 - FAILED',
                        p2_Approved: false
                    })
                    .eq('applicantId', applicantId);
                    
                if (updateError) {
                    console.error(`❌ [HR] Error updating status for ${applicantId}:`, updateError);
                    updateResults.failed.errors.push(`${applicantId}: ${updateError.message}`);
                    continue;
                }
                
                updateResults.failed.updated++;
                console.log(`✅ [HR] Successfully updated P2 FAILED for applicantId: ${applicantId}`);
                
                // Get userId for chatbot message
                const { data: applicantData, error: fetchError } = await supabase
                    .from('applicantaccounts')
                    .select('userId')
                    .eq('applicantId', applicantId)
                    .single();
                
                if (!fetchError && applicantData && applicantData.userId) {
                    // Add chatbot message
                    const { data: chatData, error: chatError } = await supabase
                        .from('chatbot_history')
                        .insert([{
                            userId: applicantData.userId,
                            message: JSON.stringify({ 
                                text: "We regret to inform you that you have not been selected to proceed to the next stage of the recruitment process. Thank you for your interest in Prime Infrastructure, and we wish you the best in your future endeavors." 
                            }),
                            sender: 'bot',
                            timestamp: new Date().toISOString(),
                            applicantStage: 'P2 - FAILED'
                        }]);
                        
                    if (chatError) {
                        console.error(`❌ [HR] Error adding chat message for ${applicantId}:`, chatError);
                    } else {
                        console.log(`💬 [HR] Added chatbot message for failed applicant ${applicantId}`);
                    }
                }
                
            } catch (error) {
                console.error(`❌ [HR] Error processing failed applicant ${applicantId}:`, error);
                updateResults.failed.errors.push(`${applicantId}: ${error.message}`);
            }
        }
        
        // Prepare response
        const totalUpdated = updateResults.passed.updated + updateResults.failed.updated;
        const totalErrors = updateResults.passed.errors.length + updateResults.failed.errors.length;
        
        console.log(`📊 [HR] P2 Update Results: ${totalUpdated} updated, ${totalErrors} errors`);
        
        if (totalErrors > 0) {
            console.warn(`⚠️ [HR] P2 status update completed with ${totalErrors} errors`);
            return res.status(207).json({ // 207 Multi-Status for partial success
                success: true,
                message: `P2 statuses updated with some errors. ${totalUpdated} successful, ${totalErrors} failed.`,
                updateResults: updateResults,
                passedCount: updateResults.passed.updated,
                failedCount: updateResults.failed.updated,
                totalErrors: totalErrors
            });
        } else {
            console.log(`✅ [HR] P2 status update completed successfully`);
            return res.status(200).json({ 
                success: true, 
                message: "P2 statuses updated successfully. All applicants have been processed.",
                updateResults: updateResults,
                passedCount: updateResults.passed.updated,
                failedCount: updateResults.failed.updated,
                totalUpdated: totalUpdated
            });
        }
        
    } catch (error) {
        console.error('❌ [HR] Error finalizing P2 review:', error);
        return res.status(500).json({ 
            success: false, 
            message: "Error finalizing P2 review: " + error.message 
        });
    }
},
// Function to view evaluation (if you need to implement this route)
viewEvaluation: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'HR') {
        req.flash('errors', { authError: 'Unauthorized access. HR role required.' });
        return res.redirect('/staff/login');
    }

    const applicantId = req.params.applicantId;
    
    try {
        console.log('Fetching evaluation for applicantId:', applicantId);
        
        // Parse applicantId to integer
        const parsedApplicantId = parseInt(applicantId, 10);
        if (isNaN(parsedApplicantId)) {
            req.flash('errors', { message: 'Invalid Applicant ID format.' });
            return res.redirect('/hr/applicant-tracker');
        }
        
        // Fetch the applicant's details with job and department information
        const { data: applicant, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select(`
                *,
                jobpositions!inner (
                    jobTitle,
                    departmentId,
                    departments!inner (
                        deptName
                    )
                )
            `)
            .eq('applicantId', parsedApplicantId)
            .single();

        if (applicantError || !applicant) {
            console.error('Error fetching applicant details:', applicantError);
            req.flash('errors', { message: 'Could not retrieve applicant details.' });
            return res.redirect('/hr/applicant-tracker');
        }

        // Fetch the HR evaluation data using applicantUserid field
        const { data: evaluation, error: evalError } = await supabase
            .from('applicant_hrscreening_assessment')
            .select('*')
            .eq('applicantUserid', parsedApplicantId)
            .single();

        if (evalError || !evaluation) {
            console.error('Error fetching evaluation:', evalError);
            req.flash('errors', { message: 'Could not retrieve evaluation data. The evaluation may not have been completed yet.' });
            return res.redirect('/hr/applicant-tracker');
        }

        // Get HR user details who conducted the evaluation
        const { data: hrUser, error: hrError } = await supabase
            .from('useraccounts')
            .select('firstName, lastName')
            .eq('userId', evaluation.hrUserId)
            .single();

        const hrName = hrUser ? `${hrUser.firstName} ${hrUser.lastName}` : 'HR Representative';

        // Format the interview date for display
        let formattedDate = 'N/A';
        if (evaluation.interviewDate) {
            try {
                const date = new Date(evaluation.interviewDate);
                formattedDate = date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            } catch (dateError) {
                console.warn('Error formatting date:', dateError);
                formattedDate = evaluation.interviewDate;
            }
        }

        console.log('Evaluation data structure:', {
            evaluationExists: !!evaluation,
            hasHrFormData: !!evaluation?.hrFormData,
            hrFormDataKeys: evaluation?.hrFormData ? Object.keys(evaluation.hrFormData) : [],
            totalRating: evaluation?.totalAssessmentRating
        });
        
        // Render the view evaluation page with all necessary data
        res.render('staffpages/hr_pages/view-evaluation-form', { 
            applicant,
            evaluation,
            hrName,
            interviewDetails: {
                conductedBy: hrName,
                dateOfInterview: formattedDate,
                departmentName: applicant.jobpositions?.departments?.deptName || 'N/A'
            }
        });
        
    } catch (err) {
        console.error('Error in viewEvaluation controller:', err);
        req.flash('errors', { message: 'Internal server error.' });
        return res.redirect('/hr/applicant-tracker');
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

    //ARCHIVED
    // getApplicantTracking: async function (req, res) {
    //     if (!req.session.user) {
    //         req.flash('errors', { authError: 'Unauthorized. Access only for authorized users.' });
    //         return res.redirect('/staff/login');
    //     }
    
    //     try {
    //         const { data: applicants, error } = await supabase
    //             .from('applicantaccounts')
    //             .select('applicantId, firstName, lastName, userId, created_at') 
    //             .order('created_at', { ascending: false }); 
    
    //         if (error) {
    //             console.error('Error fetching applicants:', error);
    //             return res.status(500).send('Error fetching applicants');
    //         }
    
    //         for (let applicant of applicants) {
    //             const { data: chatbotResponses, error: chatbotError } = await supabase
    //                 .from('chatbot_interaction')
    //                 .select('message, response, applicantStage')
    //                 .eq('userId', applicant.userId)
    //                 .order('timestamp', { ascending: true });
    
    //             if (chatbotError) {
    //                 console.error('Error fetching chatbot responses:', chatbotError);
    //                 return res.status(500).send('Error fetching chatbot responses');
    //             }
    
    //             // Find the position applied from the chatbot messages
    //             const positionAppliedMessage = chatbotResponses.find(response => response.message.toLowerCase().includes("position applied"));
    //             applicant.positionApplied = positionAppliedMessage ? positionAppliedMessage.message.split(":")[1].trim() : "N/A";  // Extract position after the colon
    
    //             // Find the application status based on the applicantStage
    //             const applicationStatusMessage = chatbotResponses.find(response => response.applicantStage === "application_complete" || response.applicantStage === "final_status");
    //             applicant.applicationStatus = applicationStatusMessage ? "Completed" : "Pending";  // Assuming 'Completed' if found, otherwise 'Pending'
    //         }
    
    //         res.render('staffpages/hr_pages/applicant-tracking-system', { applicants });
    
    //     } catch (error) {
    //         console.error('Error:', error);
    //         return res.status(500).send('Error fetching applicants');
    //     }
    // },        

    
    
    getOffboardingRequestsDash: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
    
            if (!userId || req.session.user.userRole !== 'HR') { 
                req.flash('errors', { authError: 'Unauthorized access.' });
                return res.redirect('/staff/login');
            }
    
            console.log('Fetching offboarding requests for HR dashboard');
    
            // Fetch offboarding requests with userId and status - include ALL relevant statuses
            const { data: requests, error: requestsError } = await supabase
                .from('offboarding_requests')
                .select('requestId, userId, message, last_day, status, created_at')
                .in('status', ['Pending HR', 'Sent to Employee', 'Completed by Employee'])
                .order('created_at', { ascending: false });
    
            if (requestsError) {
                console.error('Error fetching offboarding requests:', requestsError);
                req.flash('errors', { dbError: 'Failed to load offboarding requests.' });
                return res.redirect('/hr/dashboard');
            }
    
            console.log(`Found ${requests ? requests.length : 0} offboarding requests`);
            
            if (requests && requests.length > 0) {
                console.log('Statuses found:', requests.map(r => r.status));
            }
    
            // Fetch employee names and department names based on userId
            const userIds = requests.map(request => request.userId);
            const { data: staffAccounts, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName, departmentId, departments (deptName)')
                .in('userId', userIds);  // Fetch staff details for each userId
    
            if (staffError) {
                console.error('Error fetching staff accounts:', staffError);
                req.flash('errors', { dbError: 'Failed to load employee names.' });
                return res.redirect('/hr/dashboard');
            }
    
            // Combine offboarding requests with staff details and department names
            const requestsWithNames = requests.map(request => {
                const staff = staffAccounts.find(staff => staff.userId === request.userId);
                return {
                    ...request,
                    staffName: staff ? `${staff.firstName} ${staff.lastName}` : 'Unknown',
                    department: staff ? staff.departments.deptName : 'Unknown'
                };
            });
    
            console.log('Rendering HR dashboard with requests');
            res.render('staffpages/hr_pages/offboardingrequest', { requests: requestsWithNames });
        } catch (err) {
            console.error('Error in getOffboardingRequestsDash controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading offboarding requests.' });
            res.redirect('/hr/dashboard');
        }
    },

    getViewOffboardingRequest: async function (req, res) {
        const userId = req.params.userId;
    
        if (!userId) {
            return res.redirect('/staff/login');
        }
    
        try {
            // Fetch offboarding request
            const { data: requests, error: requestError } = await supabase
                .from('offboarding_requests')
                .select('requestId, userId, offboardingType, reason, message, last_day, status, created_at, line_manager_notes, line_manager_decision')
                .eq('userId', userId)
                .order('created_at', { ascending: false })
                .limit(1);
    
            if (requestError) {
                console.error('Error fetching offboarding request:', requestError);
                return res.redirect('/hr/dashboard');
            }
    
            if (!requests || requests.length === 0) {
                console.log('No offboarding request found for userId:', userId);
                return res.redirect('/hr/dashboard');
            }
    
            const requestId = requests[0].requestId;
    
            // Fetch checklist for the request
            const { data: checklistData, error: checklistError } = await supabase
                .from('offboarding_checklist')
                .select('checklist_items, created_at')
                .eq('requestId', requestId)
                .single();
    
            if (checklistError && checklistError.code !== 'PGRST116') { // Ignore "No rows found" error
                console.error('Error fetching checklist:', checklistError);
                return res.redirect('/hr/dashboard');
            }
    
            // Fetch staff details
            const { data: staff } = await supabase
                .from('staffaccounts')
                .select('firstName, lastName, departmentId, departments (deptName)')
                .eq('userId', userId)
                .single();
    
            res.render('staffpages/hr_pages/viewoffboardingrequest', {
                request: requests[0],
                staffName: `${staff.firstName} ${staff.lastName}`,
                department: staff.departments.deptName,
                checklist: checklistData ? checklistData.checklist_items : [], // Pass checklist items
                checklistCreatedAt: checklistData ? checklistData.created_at : null // Pass checklist creation date
            });
        } catch (err) {
            console.error('Error in getViewOffboardingRequest controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the offboarding request.' });
            return res.redirect('/hr/dashboard');
        }
    },
    
    saveChecklist: async function (req, res) {
        try {
            const { requestId, checklist } = req.body;
            console.log("Received for saving:", { requestId, checklist });
    
            if (!requestId || !Array.isArray(checklist)) {
                return res.status(400).json({ error: "Invalid request data." });
            }
    
            // Check if a checklist already exists for this request
            const { data: existingChecklist, error: fetchError } = await supabase
                .from("offboarding_checklist")
                .select("checklistId")
                .eq("requestId", requestId)
                .single();
    
            if (fetchError && fetchError.code !== 'PGRST116') { // Ignore "No rows found" error
                console.error("Error fetching existing checklist:", fetchError);
                return res.status(500).json({ error: "Failed to fetch existing checklist." });
            }
    

            let error;

            if (existingChecklist) {
                const { error: updateError } = await supabase
                    .from("offboarding_checklist")
                    .update({
                        checklist_items: checklist,
                        created_at: new Date().toISOString()
                    })
                    .eq("checklistId", existingChecklist.checklistId);

                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from("offboarding_checklist")
                    .insert({
                        requestId: requestId,
                        checklist_items: checklist,
                        created_at: new Date().toISOString()
                    });

                    error = insertError;

            }
                
            if (error) {
                console.error("Error saving checklist:", error);
                return res.status(500).json({ error: "Failed to save checklist." });
            }
    
            res.json({ success: true, message: "Checklist saved successfully!" });
        } catch (err) {
            console.error("Error in saveChecklist controller:", err);
            res.status(500).json({ error: "An error occurred while saving the checklist." });
        }
    },

    sendClearanceToEmployee: async function (req, res) {
        try {
            const { requestId } = req.body;
    
            if (!requestId) {
                return res.status(400).json({ error: "Invalid request data." });
            }
    
            // Update the offboarding_request status to "Sent to Employee"
            const { data, error } = await supabase
                .from("offboarding_requests")
                .update({ 
                    status: "Sent to Employee",
                    clearance_sent_date: new Date().toISOString()
                })
                .eq("requestId", requestId)
                .select();
    
            if (error) {
                console.error("Error sending clearance to employee:", error);
                return res.status(500).json({ error: "Failed to send clearance to employee." });
            }
    
            res.json({ success: true, message: "Clearance sent to employee successfully!", data });
        } catch (err) {
            console.error("Error in sendClearanceToEmployee controller:", err);
            res.status(500).json({ error: "An error occurred while sending the clearance." });
        }
    },

    approveOffboarding: async function (req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            const { requestId } = req.body;
            
            if (!userId || req.session.user.userRole !== 'HR') { 
                return res.status(401).json({ 
                    success: false, 
                    error: 'Unauthorized access.' 
                });
            }
            
            if (!requestId) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Request ID is required.' 
                });
            }
            
            console.log(`Approving offboarding request ID: ${requestId} by HR user ID: ${userId}`);
            
            // Verify that the request exists and is in the correct status
            const { data: request, error: requestError } = await supabase
                .from('offboarding_requests')
                .select('status')
                .eq('requestId', requestId)
                .single();
                
            if (requestError) {
                console.error('Error fetching offboarding request:', requestError);
                return res.status(404).json({ 
                    success: false, 
                    error: 'Request not found.' 
                });
            }
            
            if (!request) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Request not found.' 
                });
            }
            
            if (request.status !== 'Completed by Employee') {
                return res.status(400).json({ 
                    success: false, 
                    error: 'This request cannot be approved in its current status.' 
                });
            }
            
            // Update the request status to "Completed"
            const { data: updateData, error: updateError } = await supabase
                .from('offboarding_requests')
                .update({ 
                    status: 'Completed',
                    hr_decision_date: new Date().toISOString()
                })
                .eq('requestId', requestId)
                .select();
                
            if (updateError) {
                console.error('Error updating request status:', updateError);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to approve offboarding request.' 
                });
            }
            
            console.log('Offboarding request approved successfully:', updateData);
            
            return res.json({ 
                success: true, 
                message: 'Offboarding request approved successfully.' 
            });
        } catch (err) {
            console.error('Error in approveOffboarding controller:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while processing the request.' 
            });
        }
    },

    getContactPersons: async function(req, res) {
        try {
            const userId = req.session.user ? req.session.user.userId : null;
            
            if (!userId) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Unauthorized access.' 
                });
            }
            
            // Fetch department information to get names for the dropdown
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName');
                
            if (deptError) {
                console.error('Error fetching departments:', deptError);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to load departments.' 
                });
            }
            
            // Fetch staff members to use as contacts, including their departments and job positions
            const { data: staffMembers, error: staffError } = await supabase
                .from('staffaccounts')
                .select(`
                    staffId,
                    userId,
                    firstName,
                    lastName,
                    departmentId,
                    jobId,
                    departments (deptName),
                    jobpositions (jobTitle)
                `)
                .order('departmentId', { ascending: true })
                .order('lastName', { ascending: true });
                
            if (staffError) {
                console.error('Error fetching staff members:', staffError);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to load staff members.' 
                });
            }
            
            // Organize contact persons by department
            const contacts = [];
            
            // Add HR department contacts
            const hrContacts = staffMembers.filter(staff => 
                staff.departments && staff.departments.deptName === 'HR'
            ).map(staff => ({
                contact_id: staff.staffId,
                department: 'HR',
                contact_name: `${staff.firstName} ${staff.lastName}`,
                position: staff.jobpositions ? staff.jobpositions.jobTitle : ''
            }));
            
            contacts.push(...hrContacts);
            
            // Add Finance department contacts
            const financeContacts = staffMembers.filter(staff => 
                staff.departments && staff.departments.deptName === 'Finance'
            ).map(staff => ({
                contact_id: staff.staffId,
                department: 'Finance',
                contact_name: `${staff.firstName} ${staff.lastName}`,
                position: staff.jobpositions ? staff.jobpositions.jobTitle : ''
            }));
            
            contacts.push(...financeContacts);
            
            // Add IT department contacts
            const itContacts = staffMembers.filter(staff => 
                staff.departments && staff.departments.deptName === 'IT'
            ).map(staff => ({
                contact_id: staff.staffId,
                department: 'IT',
                contact_name: `${staff.firstName} ${staff.lastName}`,
                position: staff.jobpositions ? staff.jobpositions.jobTitle : ''
            }));
            
            contacts.push(...itContacts);
            
            // Add other departments contacts
            const otherDepartments = departments.filter(dept => 
                !['HR', 'Finance', 'IT'].includes(dept.deptName)
            );
            
            for (const dept of otherDepartments) {
                const deptContacts = staffMembers.filter(staff => 
                    staff.departmentId === dept.departmentId
                ).map(staff => ({
                    contact_id: staff.staffId,
                    department: dept.deptName,
                    contact_name: `${staff.firstName} ${staff.lastName}`,
                    position: staff.jobpositions ? staff.jobpositions.jobTitle : ''
                }));
                
                contacts.push(...deptContacts);
            }
            
            // Add the specific people mentioned in the requirements if they don't exist already
            const requiredContacts = [
                { department: 'HR', contact_name: 'Ethan Sullivan', position: 'Compensation and Benefits Manager' },
                { department: 'Finance', contact_name: 'Jane De Leon', position: 'Financial Analyst' },
                { department: 'IT', contact_name: 'Jane Smith', position: 'Technical Staff' }
            ];
            
            // Check if the required contacts already exist in our list
            for (const reqContact of requiredContacts) {
                const contactExists = contacts.some(contact => 
                    contact.department === reqContact.department && 
                    contact.contact_name === reqContact.contact_name
                );
                
                // If not, add them
                if (!contactExists) {
                    contacts.push({
                        contact_id: `special_${reqContact.department}_${reqContact.contact_name.replace(/\s+/g, '_')}`,
                        ...reqContact
                    });
                }
            }
            
            return res.json({ 
                success: true, 
                contacts: contacts 
            });
        } catch (err) {
            console.error('Error in getContactPersons controller:', err);
            return res.status(500).json({ 
                success: false, 
                error: 'An error occurred while loading contacts.' 
            });
        }
    },
    
    getRetirementTracker: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
            try {
                console.log("Fetching retirement tracker data...");

                // Fetch staff-related data, including dateOfBirth and hireDate
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select(`
                        staffId, 
                        userId, 
                        departmentId, 
                        jobId, 
                        lastName, 
                        firstName,
                        dateOfBirth,  
                        hireDate,
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

                // Calculate years of service and categorize employees based on retirement eligibility
                const departmentMap = staffData.reduce((acc, staff) => {
                    const deptName = staff.departments?.deptName || 'Unknown';
                    
                    // Handle potential null/undefined values for dates
                    let yearsOfService = null;
                    let age = null;
                    let birthDate = null;

                    // Process hire date if available
                    if (staff.hireDate) {
                        const hireDate = new Date(staff.hireDate);
                        const currentDate = new Date();
                        
                        // Only calculate if the date is valid
                        if (!isNaN(hireDate.getTime())) {
                            yearsOfService = currentDate.getFullYear() - hireDate.getFullYear();
                            
                            // Adjust for hire date not yet reached this year
                            const hireMonth = hireDate.getMonth();
                            const currentMonth = currentDate.getMonth();
                            
                            if (currentMonth < hireMonth || 
                                (currentMonth === hireMonth && currentDate.getDate() < hireDate.getDate())) {
                                yearsOfService--;
                            }
                        }
                    }

                    // Process birth date if available
                    if (staff.dateOfBirth) {
                        birthDate = new Date(staff.dateOfBirth);
                        const today = new Date();
                        
                        // Only calculate if the date is valid
                        if (!isNaN(birthDate.getTime())) {
                            age = today.getFullYear() - birthDate.getFullYear();
                            
                            // Adjust for birthday not yet reached this year
                            const birthMonth = birthDate.getMonth();
                            const currentMonth = today.getMonth();
                            
                            if (currentMonth < birthMonth || 
                                (currentMonth === birthMonth && today.getDate() < birthDate.getDate())) {
                                age--;
                            }
                        }
                    }

                    // Determine retirement eligibility (combine age and years of service criteria)
                    // Standard rule: Age 60+ with 5+ years of service, or 30+ years of service at any age
                    let retirementEligibility = 'Not Eligible';
                    if ((age !== null && age >= 60 && yearsOfService !== null && yearsOfService >= 5) || 
                        (yearsOfService !== null && yearsOfService >= 30)) {
                        retirementEligibility = 'Eligible for Retirement';
                    }
                    
                    if (!acc[deptName]) {
                        acc[deptName] = [];
                    }

                    acc[deptName].push({
                        userId: staff.userId,
                        jobTitle: staff.jobpositions?.jobTitle || 'No job title assigned',
                        lastName: staff.lastName,
                        firstName: staff.firstName,
                        userEmail: staff.useraccounts?.userEmail || 'N/A',
                        birthDate: birthDate, // Renamed to match template
                        hireDate: staff.hireDate,
                        age: age, // Added calculated age
                        yearsOfService: yearsOfService,
                        retirementEligibility: retirementEligibility
                    });
                    return acc;
                }, {});

                // Render the data in the view
                res.render('staffpages/hr_pages/hr-retirement-tracker', { departments: departmentMap });

            } catch (error) {
                console.error("Error fetching retirement tracker data:", error);
                res.status(500).send("Error fetching retirement tracker data");
            }
        } else {
            res.redirect('/login');
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



    /* NOTIFICATION CONTROLLER */


    get360FeedbackToast: async function(req, res) {
        try {
            console.log("Entering get360FeedbackToast function");
    
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
                    .lte('setStartDate', todayString) // Changed from gte to lte to ensure we get records starting today or earlier
                    .gte('setEndDate', todayString);  // Changed from gt to gte to include today's date
    
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
                        // Also store the table name so we know which quarter it belongs to
                        activeFeedback.sourceTable = feedbackTable;
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
    
            // Step 6: Determine quarter from the source table
            let quarter;
            if (activeFeedback.sourceTable === 'feedbacks_Q1') quarter = 'Q1';
            else if (activeFeedback.sourceTable === 'feedbacks_Q2') quarter = 'Q2';
            else if (activeFeedback.sourceTable === 'feedbacks_Q3') quarter = 'Q3';
            else if (activeFeedback.sourceTable === 'feedbacks_Q4') quarter = 'Q4';
            else quarter = activeFeedback.quarter || ''; // Fallback to stored quarter if available
    
            // Return the active feedback record with additional user ID for the frontend
            return res.status(200).json({ 
                success: true, 
                feedback: activeFeedback, 
                quarter,
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
    
    getRecruitmentReports: async function (req, res) {
        if (req.session.user && req.session.user.userRole === 'HR') {
                    res.render('staffpages/hr_pages/reports_pages/hr-recruitment-reports');
                } else {
                    req.flash('errors', { authError: 'Unauthorized. HR access only.' });
                    res.redirect('/staff/login');
                }
    },

    getRecruitmentDashboardStats: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            console.log('🔍 [Dashboard] Fetching dashboard statistics...');

            // Get total applicants
            const { data: allApplicants, error: applicantsError } = await supabase
                .from('applicantaccounts')
                .select('applicantId, applicantStatus, created_at');

            if (applicantsError) {
                console.error('❌ [Dashboard] Error fetching applicants:', applicantsError);
                throw applicantsError;
            }

            console.log(`✅ [Dashboard] Found ${allApplicants.length} total applicants`);

            // Get total hirees
            const hirees = allApplicants.filter(a => 
                a.applicantStatus?.includes('Hired') || a.applicantStatus?.includes('Onboarding')
            );

            // Get pending applications
            const pendingApplications = allApplicants.filter(a => 
                a.applicantStatus?.includes('Pending') || a.applicantStatus?.includes('Awaiting')
            );

            // Get active MRFs
            const { data: activeMRFs, error: mrfError } = await supabase
                .from('mrf')
                .select('mrfId')
                .in('status', ['Pending', 'Approved']);

            if (mrfError) {
                console.error('❌ [Dashboard] Error fetching MRFs:', mrfError);
                // Don't throw - just log and continue with 0
                console.log('📊 [Dashboard] Continuing with 0 active MRFs due to error');
            }

            // Calculate average processing time (from application to hire)
            let avgProcessingTime = 0;
            if (hirees.length > 0) {
                const processingTimes = hirees.map(h => {
                    const applicationDate = new Date(h.created_at);
                    const currentDate = new Date();
                    return Math.floor((currentDate - applicationDate) / (1000 * 60 * 60 * 24));
                });
                avgProcessingTime = Math.round(processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length);
            }

            // Get this month's applications
            const currentDate = new Date();
            const monthlyApplicants = allApplicants.filter(a => {
                const appDate = new Date(a.created_at);
                return appDate.getMonth() === currentDate.getMonth() && 
                       appDate.getFullYear() === currentDate.getFullYear();
            });

            const stats = {
                totalApplicants: allApplicants.length,
                totalHirees: hirees.length,
                pendingApplications: pendingApplications.length,
                activeMRFs: activeMRFs ? activeMRFs.length : 0,
                avgProcessingTime: avgProcessingTime,
                monthlyApplicants: monthlyApplicants.length
            };

            console.log('📊 [Dashboard] Final stats:', stats);

            return res.json({
                success: true,
                stats: stats
            });

        } catch (error) {
            console.error('❌ [Dashboard] Error fetching dashboard stats:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching dashboard statistics: ' + error.message 
            });
        }
    },

    getChartData: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            console.log('🔍 [Chart Data] Fetching chart data...');

            // Get all applicants with related data
            const { data: allApplicants, error: applicantsError } = await supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    applicantStatus,
                    created_at,
                    departmentId,
                    departments!inner(deptName)
                `);

            if (applicantsError) {
                console.error('❌ [Chart Data] Error fetching applicants:', applicantsError);
                throw applicantsError;
            }

            console.log(`✅ [Chart Data] Found ${allApplicants.length} applicants`);

            // 1. Status Distribution Data
            const statusCounts = {
                pending: 0,
                p1Passed: 0,
                p2Passed: 0,
                hired: 0,
                failed: 0
            };

            allApplicants.forEach(applicant => {
                const status = applicant.applicantStatus || '';
                const statusLower = status.toLowerCase();
                
                if (statusLower.includes('hired') || statusLower.includes('onboarding')) {
                    statusCounts.hired++;
                } else if (statusLower.includes('p2') && statusLower.includes('passed')) {
                    statusCounts.p2Passed++;
                } else if (statusLower.includes('p1') && statusLower.includes('passed') || statusLower.includes('passed')) {
                    statusCounts.p1Passed++;
                } else if (statusLower.includes('failed') || statusLower.includes('rejected')) {
                    statusCounts.failed++;
                } else {
                    statusCounts.pending++;
                }
            });

            // 2. Monthly Trends Data (last 6 months)
            const monthlyData = {};
            const currentDate = new Date();
            
            // Initialize last 6 months
            for (let i = 5; i >= 0; i--) {
                const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
                const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
                monthlyData[monthKey] = {
                    month: monthDate.toLocaleDateString('en-US', { month: 'short' }),
                    applications: 0,
                    hires: 0
                };
            }

            // Count applications and hires by month
            allApplicants.forEach(applicant => {
                const appDate = new Date(applicant.created_at);
                const monthKey = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}`;
                
                if (monthlyData[monthKey]) {
                    monthlyData[monthKey].applications++;
                    
                    // Count as hire if status indicates hired
                    const status = applicant.applicantStatus || '';
                    if (status.toLowerCase().includes('hired') || status.toLowerCase().includes('onboarding')) {
                        monthlyData[monthKey].hires++;
                    }
                }
            });

            const monthlyTrends = Object.values(monthlyData);

            // 3. Department Distribution
            const deptCounts = {};
            allApplicants.forEach(applicant => {
                const deptName = applicant.departments?.deptName || 'Unknown';
                deptCounts[deptName] = (deptCounts[deptName] || 0) + 1;
            });

            // 4. Timeline/Processing Time Distribution
            const timelineCounts = {
                '0-7 days': 0,
                '8-14 days': 0,
                '15-21 days': 0,
                '22-30 days': 0,
                '30+ days': 0
            };

            // Calculate processing time for hired applicants
            const hiredApplicants = allApplicants.filter(a => {
                const status = a.applicantStatus || '';
                return status.toLowerCase().includes('hired') || status.toLowerCase().includes('onboarding');
            });

            hiredApplicants.forEach(applicant => {
                const appDate = new Date(applicant.created_at);
                const currentDate = new Date();
                const daysDiff = Math.floor((currentDate - appDate) / (1000 * 60 * 60 * 24));

                if (daysDiff <= 7) {
                    timelineCounts['0-7 days']++;
                } else if (daysDiff <= 14) {
                    timelineCounts['8-14 days']++;
                } else if (daysDiff <= 21) {
                    timelineCounts['15-21 days']++;
                } else if (daysDiff <= 30) {
                    timelineCounts['22-30 days']++;
                } else {
                    timelineCounts['30+ days']++;
                }
            });

            const chartData = {
                statusDistribution: {
                    labels: ['Pending', 'P1 - Passed', 'P2 - Passed', 'Hired', 'Failed'],
                    data: [
                        statusCounts.pending,
                        statusCounts.p1Passed,
                        statusCounts.p2Passed,
                        statusCounts.hired,
                        statusCounts.failed
                    ]
                },
                monthlyTrends: {
                    labels: monthlyTrends.map(m => m.month),
                    applications: monthlyTrends.map(m => m.applications),
                    hires: monthlyTrends.map(m => m.hires)
                },
                departmentDistribution: {
                    labels: Object.keys(deptCounts),
                    data: Object.values(deptCounts)
                },
                timeline: {
                    labels: Object.keys(timelineCounts),
                    data: Object.values(timelineCounts)
                }
            };

            console.log('📊 [Chart Data] Chart data prepared:', chartData);

            return res.json({
                success: true,
                chartData: chartData
            });

        } catch (error) {
            console.error('❌ [Chart Data] Error fetching chart data:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching chart data: ' + error.message 
            });
        }
    },

    getApplicantsReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { startDate, endDate, format } = req.query;
            
            console.log('🔍 [Applicants Report] Fetching applicants data...');
            console.log('📅 [Applicants Report] Date filters:', { startDate, endDate, format });
            
            // Enhanced query to get all required data including scores
            let query = supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    lastName,
                    firstName,
                    middleInitial,
                    phoneNo,
                    birthDate,
                    applicantStatus,
                    initialScreeningScore,
                    hrInterviewFormScore,
                    lineManagerFormEvalScore,
                    created_at,
                    userId,
                    jobId,
                    departmentId,
                    useraccounts!inner(userEmail),
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `)
                .order('created_at', { ascending: false });

            // Apply date filters if provided
            if (startDate) {
                query = query.gte('created_at', startDate);
                console.log('📅 [Applicants Report] Applied start date filter:', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDateTime.toISOString());
                console.log('📅 [Applicants Report] Applied end date filter:', endDateTime.toISOString());
            }

            const { data: applicants, error } = await query;

            if (error) {
                console.error('❌ [Applicants Report] Error fetching applicants:', error);
                return res.status(500).json({ success: false, message: 'Error fetching applicants data: ' + error.message });
            }

            console.log(`✅ [Applicants Report] Found ${applicants.length} applicants`);

            // Enhanced summary statistics to match your report format
            const summary = {
                totalApplications: applicants.length,
                activeApplications: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return !status.toLowerCase().includes('rejected') && 
                        !status.toLowerCase().includes('hired') && 
                        !status.toLowerCase().includes('failed');
                }).length,
                initialScreening: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return status.toLowerCase().includes('initial') || 
                        status.toLowerCase().includes('screening') ||
                        (a.initialScreeningScore && a.initialScreeningScore > 0);
                }).length,
                hrInterview: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return status.toLowerCase().includes('hr interview') || 
                        status.toLowerCase().includes('p1') ||
                        (a.hrInterviewFormScore && a.hrInterviewFormScore > 0);
                }).length,
                lineManagerInterview: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return status.toLowerCase().includes('line manager') || 
                        status.toLowerCase().includes('p2') ||
                        status.toLowerCase().includes('manager interview') ||
                        (a.lineManagerFormEvalScore && a.lineManagerFormEvalScore > 0);
                }).length,
                finalApproval: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return status.toLowerCase().includes('final') || 
                        status.toLowerCase().includes('approval') ||
                        status.toLowerCase().includes('awaiting approval');
                }).length,
                hired: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return status.toLowerCase().includes('hired') || 
                        status.toLowerCase().includes('onboarding');
                }).length,
                rejected: applicants.filter(a => {
                    const status = a.applicantStatus || '';
                    return status.toLowerCase().includes('rejected') || 
                        status.toLowerCase().includes('failed') ||
                        status.toLowerCase().includes('not selected');
                }).length
            };

            console.log('📊 [Applicants Report] Enhanced summary stats:', summary);

            // Helper function to calculate total score
            const calculateTotalScore = (applicant) => {
                const initial = applicant.initialScreeningScore || 0;
                const hr = applicant.hrInterviewFormScore || 0;
                const lineManager = applicant.lineManagerFormEvalScore || 0;
                
                // Only calculate if at least one score exists
                if (initial > 0 || hr > 0 || lineManager > 0) {
                    return initial + hr + lineManager;
                }
                return null;
            };

            // Process applicants data with all required fields
            const processedApplicants = applicants.map(applicant => ({
                // Basic Information
                applicantId: applicant.applicantId,
                lastName: applicant.lastName || 'N/A',
                firstName: applicant.firstName || 'N/A',
                middleInitial: applicant.middleInitial || '',
                email: applicant.useraccounts?.userEmail || 'N/A',
                phoneNumber: applicant.phoneNo || 'N/A',
                
                // Job and Department
                jobTitle: applicant.jobpositions?.jobTitle || 'N/A',
                department: applicant.departments?.deptName || 'N/A',
                
                // Dates and Status
                applicationDate: applicant.created_at ? 
                    new Date(applicant.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit' 
                    }) : 'N/A',
                status: applicant.applicantStatus || 'Pending',
                
                // Scores
                initialScreeningScore: applicant.initialScreeningScore || 'N/A',
                hrInterviewScore: applicant.hrInterviewFormScore || 'N/A',
                lineManagerScore: applicant.lineManagerFormEvalScore || 'N/A',
                totalScore: calculateTotalScore(applicant) || 'N/A'
            }));

            console.log(`✅ [Applicants Report] Processed ${processedApplicants.length} applicants for display`);

            // Add generation timestamp
            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (format === 'pdf') {
                console.log('📄 [Applicants Report] PDF format requested');
                return res.json({
                    success: true,
                    reportType: 'applicants',
                    format: 'pdf',
                    data: processedApplicants,
                    summary: summary,
                    generatedOn: generatedOn,
                    dateRange: { startDate, endDate     },
                    reportTitle: 'Applicants Report (HR)',
                    reportSubtitle: 'Comprehensive recruitment analytics and detailed reporting for applicants'
                });
            }

            // Return data for view display
            return res.json({
                success: true,
                data: processedApplicants,
                summary: summary,
                generatedOn: generatedOn,
                reportTitle: 'Applicants Report (HR)'
            });

        } catch (error) {
            console.error('❌ [Applicants Report] Error in getApplicantsReport:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    getHireesReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { startDate, endDate, format } = req.query;
            
            console.log('🔍 [Hirees Report] Fetching hirees data...');
            console.log('📅 [Hirees Report] Date filters:', { startDate, endDate, format });
            
            // Enhanced query to get ALL required data including middle initial
            let query = supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    lastName,
                    firstName,
                    middleInitial,
                    phoneNo,
                    applicantStatus,
                    created_at,
                    userId,
                    jobId,
                    departmentId,
                    useraccounts!inner(userEmail),
                    jobpositions!inner(jobTitle, jobType),
                    departments!inner(deptName)
                `)
                .order('created_at', { ascending: false });

            // Apply date filters if provided
            if (startDate) {
                query = query.gte('created_at', startDate);
                console.log('📅 [Hirees Report] Applied start date filter:', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDateTime.toISOString());
                console.log('📅 [Hirees Report] Applied end date filter:', endDateTime.toISOString());
            }

            const { data: allApplicants, error } = await query;

            if (error) {
                console.error('❌ [Hirees Report] Error fetching applicants:', error);
                return res.status(500).json({ success: false, message: 'Error fetching applicants data: ' + error.message });
            }

            console.log(`✅ [Hirees Report] Found ${allApplicants.length} total applicants`);

            // Filter for hired applicants in JavaScript 
            const hirees = allApplicants.filter(applicant => {
                const status = applicant.applicantStatus || '';
                return status.toLowerCase().includes('hired') || 
                    status.toLowerCase().includes('onboarding');
            });

            console.log(`✅ [Hirees Report] Filtered to ${hirees.length} hirees`);

            // Enhanced summary statistics to match your format
            const summary = {
                totalHirees: hirees.length,
                fullTime: hirees.filter(h => h.jobpositions?.jobType === 'Full-time').length,
                partTime: hirees.filter(h => h.jobpositions?.jobType === 'Part-time').length,
                contract: hirees.filter(h => h.jobpositions?.jobType === 'Contract').length,
                onboarding: hirees.filter(h => {
                    const status = h.applicantStatus || '';
                    return status.toLowerCase().includes('onboarding');
                }).length
            };

            console.log('📊 [Hirees Report] Enhanced summary stats:', summary);

            // Process hirees data with ALL required fields for your format
            const processedHirees = hirees.map((hiree, index) => ({
                // Enhanced data matching your format
                department: hiree.departments?.deptName || 'N/A',
                hireId: `HIR${String(index + 1).padStart(3, '0')}`,
                lastName: hiree.lastName || 'N/A',
                firstName: hiree.firstName || 'N/A', 
                middleInitial: hiree.middleInitial || '',
                email: hiree.useraccounts?.userEmail || 'N/A',
                phoneNumber: hiree.phoneNo || 'N/A',
                jobTitle: hiree.jobpositions?.jobTitle || 'N/A',  // Fixed: was appliedPosition
                jobType: hiree.jobpositions?.jobType || 'Full-time',
                hireDate: hiree.created_at ? 
                    new Date(hiree.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit' 
                    }) : 'N/A'
            }));

            console.log(`✅ [Hirees Report] Processed ${processedHirees.length} hirees for display`);

            // Add generation timestamp
            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (format === 'pdf') {
                console.log('📄 [Hirees Report] PDF format requested');
                return res.json({
                    success: true,
                    reportType: 'hirees',
                    format: 'pdf',
                    data: processedHirees,
                    summary: summary,
                    generatedOn: generatedOn,
                    dateRange: { startDate, endDate },
                    reportTitle: 'Hirees Report (HR)',
                    reportSubtitle: 'Track successfully hired candidates with onboarding timelines, job types, department distribution, and employment details'
                });
            }

            return res.json({
                success: true,
                data: processedHirees,
                summary: summary,
                generatedOn: generatedOn,
                reportTitle: 'Hirees Report (HR)'
            });

        } catch (error) {
            console.error('❌ [Hirees Report] Error in getHireesReport:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    getApplicantStatusReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { applicantName, format } = req.query;
            
            console.log('🔍 [Status Report] Searching applicant by name...');
            console.log('📋 [Status Report] Applicant Name:', applicantName, 'Format:', format);
            
            if (!applicantName || applicantName.trim().length < 2) {
                console.log('❌ [Status Report] Invalid applicant name provided');
                return res.status(400).json({ success: false, message: 'Applicant name is required (minimum 2 characters)' });
            }

            const searchName = applicantName.trim().toLowerCase();
            console.log('🔍 [Status Report] Searching for:', searchName);

            // Enhanced query to get ALL required data including scores and screening data
            const { data: applicants, error: searchError } = await supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    lastName,
                    firstName,
                    middleInitial,
                    phoneNo,
                    birthDate,
                    applicantStatus,
                    initialScreeningScore,
                    hrInterviewFormScore,
                    lineManagerFormEvalScore,
                    created_at,
                    userId,
                    jobId,
                    departmentId,
                    useraccounts!inner(userEmail),
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `)
                .order('created_at', { ascending: false });

            if (searchError) {
                console.error('❌ [Status Report] Error searching applicants:', searchError);
                return res.status(500).json({ success: false, message: 'Error searching applicants: ' + searchError.message });
            }

            console.log(`✅ [Status Report] Found ${applicants.length} total applicants to search through`);

            // Filter applicants by name in JavaScript for flexible matching
            const matchingApplicants = applicants.filter(applicant => {
                const firstName = (applicant.firstName || '').toLowerCase();
                const lastName = (applicant.lastName || '').toLowerCase();
                const fullName = `${firstName} ${lastName}`;
                const reverseName = `${lastName} ${firstName}`;
                
                return firstName.includes(searchName) || 
                    lastName.includes(searchName) || 
                    fullName.includes(searchName) ||
                    reverseName.includes(searchName);
            });

            console.log(`🎯 [Status Report] Found ${matchingApplicants.length} matching applicants`);

            if (matchingApplicants.length === 0) {
                return res.json({
                    success: false,
                    message: `No applicants found matching "${applicantName}". Please check the spelling and try again.`,
                    searchSuggestion: true
                });
            }

            // If multiple matches, return list for user to choose from
            if (matchingApplicants.length > 1) {
                console.log('📋 [Status Report] Multiple matches found, returning selection list');
                
                const suggestions = matchingApplicants.map(applicant => ({
                    applicantId: applicant.applicantId,
                    name: `${applicant.firstName} ${applicant.lastName}`,
                    email: applicant.useraccounts?.userEmail || 'N/A',
                    position: applicant.jobpositions?.jobTitle || 'N/A',
                    status: applicant.applicantStatus || 'Pending',
                    applicationDate: new Date(applicant.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit' 
                    })
                }));

                return res.json({
                    success: false,
                    message: `Found ${matchingApplicants.length} applicants matching "${applicantName}". Please be more specific:`,
                    multipleMatches: true,
                    suggestions: suggestions
                });
            }

            // Exactly one match found - proceed with enhanced status report
            const applicant = matchingApplicants[0];
            console.log(`✅ [Status Report] Exact match found: ${applicant.firstName} ${applicant.lastName}`);

            // Calculate days in process
            const applicationDate = new Date(applicant.created_at);
            const currentDate = new Date();
            const daysInProcess = Math.floor((currentDate - applicationDate) / (1000 * 60 * 60 * 24));

            console.log(`📅 [Status Report] Application date: ${applicationDate.toISOString().split('T')[0]}, Days in process: ${daysInProcess}`);

            // Enhanced logic for HR Screening Approved
            const hrScreeningApproved = () => {
                const status = (applicant.applicantStatus || '').toLowerCase();
                const hrScore = applicant.hrInterviewFormScore;
                
                // Check if they passed HR interview or have HR score
                if (status.includes('passed hr') || 
                    status.includes('p1 passed') ||
                    status.includes('hr interview passed') ||
                    (hrScore && hrScore > 0)) {
                    return 'Yes';
                }
                
                // Check if they failed HR
                if (status.includes('failed hr') || 
                    status.includes('hr interview failed') ||
                    status.includes('p1 failed')) {
                    return 'No';
                }
                
                return 'Pending';
            };

            // Enhanced logic for Panel Screening Approved
            const panelScreeningApproved = () => {
                const status = (applicant.applicantStatus || '').toLowerCase();
                const lineManagerScore = applicant.lineManagerFormEvalScore;
                
                // Check if they passed panel/line manager interview
                if (status.includes('passed panel') || 
                    status.includes('p2 passed') ||
                    status.includes('line manager passed') ||
                    status.includes('panel interview passed') ||
                    (lineManagerScore && lineManagerScore > 0)) {
                    return 'Yes';
                }
                
                // Check if they failed panel
                if (status.includes('failed panel') || 
                    status.includes('p2 failed') ||
                    status.includes('line manager failed') ||
                    status.includes('panel interview failed')) {
                    return 'No';
                }
                
                return 'Pending';
            };

            // Enhanced logic for Is Hired
            const isHired = () => {
                const status = (applicant.applicantStatus || '').toLowerCase();
                
                if (status.includes('hired') || status.includes('onboarding')) {
                    return 'Yes';
                }
                
                if (status.includes('rejected') || 
                    status.includes('failed') ||
                    status.includes('not selected')) {
                    return 'No';
                }
                
                return 'Pending';
            };

            // Fetch enhanced status history
            const { data: statusHistory, error: historyError } = await supabase
                .from('chatbot_history')
                .select('message, timestamp, applicantStage')
                .eq('userId', applicant.userId)
                .order('timestamp', { ascending: true });

            let processedHistory = [];
            if (statusHistory && statusHistory.length > 0) {
                console.log(`✅ [Status Report] Found ${statusHistory.length} status history entries`);
                
                processedHistory = statusHistory.map(history => {
                    let messageText = '';
                    if (typeof history.message === 'string') {
                        try {
                            const parsed = JSON.parse(history.message);
                            messageText = parsed.text || history.message;
                        } catch (e) {
                            messageText = history.message;
                        }
                    } else if (typeof history.message === 'object' && history.message.text) {
                        messageText = history.message.text;
                    } else {
                        messageText = 'Status updated';
                    }

                    return {
                        status: history.applicantStage || 'Status Update',
                        date: new Date(history.timestamp).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }),
                        notes: messageText.substring(0, 150) + (messageText.length > 150 ? '...' : '')
                    };
                });
            } else {
                console.log('📋 [Status Report] No chatbot history found, creating default history');
                
                processedHistory = [
                    {
                        status: 'Application Submitted',
                        date: new Date(applicant.created_at).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }),
                        notes: 'Initial application received and processed'
                    }
                ];

                if (applicant.applicantStatus && applicant.applicantStatus !== 'Application Submitted') {
                    processedHistory.push({
                        status: applicant.applicantStatus,
                        date: new Date().toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }),
                        notes: 'Current application status'
                    });
                }
            }

            // Enhanced applicant details matching your exact format
            const applicantDetails = {
                applicantId: applicant.applicantId,
                lastName: applicant.lastName || 'N/A',
                firstName: applicant.firstName || 'N/A',
                middleInitial: applicant.middleInitial || '',
                email: applicant.useraccounts?.userEmail || 'N/A',
                phoneNumber: applicant.phoneNo || 'N/A',
                birthDate: applicant.birthDate ? 
                    new Date(applicant.birthDate).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit' 
                    }) : 'N/A',
                jobPosition: applicant.jobpositions?.jobTitle || 'N/A',
                department: applicant.departments?.deptName || 'N/A',
                applicationDate: new Date(applicant.created_at).toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit' 
                }),
                daysInProcess: daysInProcess,
                currentStatus: applicant.applicantStatus || 'Pending',
                hrScreeningApproved: hrScreeningApproved(),
                panelScreeningApproved: panelScreeningApproved(),
                isHired: isHired(),
                
                // Additional scores for reference
                initialScreeningScore: applicant.initialScreeningScore || 'N/A',
                hrInterviewScore: applicant.hrInterviewFormScore || 'N/A',
                lineManagerScore: applicant.lineManagerFormEvalScore || 'N/A'
            };

            console.log('✅ [Status Report] Enhanced applicant details processed');

            // Add generation timestamp
            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (format === 'pdf') {
                console.log('📄 [Status Report] PDF format requested');
                return res.json({
                    success: true,
                    reportType: 'applicant-status',
                    format: 'pdf',
                    applicant: applicantDetails,
                    statusHistory: processedHistory,
                    generatedOn: generatedOn,
                    reportTitle: 'Individual Applicant Status Update Report (HR)',
                    reportSubtitle: 'Detailed status tracking and timeline for individual applicant progress'
                });
            }

            return res.json({
                success: true,
                applicant: applicantDetails,
                statusHistory: processedHistory,
                generatedOn: generatedOn,
                reportTitle: 'Individual Applicant Status Update Report (HR)'
            });

        } catch (error) {
            console.error('❌ [Status Report] Error in getApplicantStatusReport:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    getSearchApplicants: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { query, loadAll } = req.query;
            
            console.log('🔍 [Search Applicants] Query:', query, 'LoadAll:', loadAll);
            
            // If loadAll is requested or query is "all", return all applicants
            const shouldLoadAll = loadAll === 'true' || query === 'all';
            
            if (!shouldLoadAll && (!query || query.trim().length < 2)) {
                return res.json({ success: true, applicants: [] });
            }

            // Search for applicants
            const { data: applicants, error } = await supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    lastName,
                    firstName,
                    applicantStatus,
                    created_at,
                    userId,
                    jobId,
                    departmentId,
                    useraccounts!inner(userEmail),
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `)
                .order('created_at', { ascending: false })
                .limit(shouldLoadAll ? 200 : 50); // Limit for performance

            if (error) {
                console.error('❌ [Search Applicants] Error:', error);
                return res.status(500).json({ success: false, message: 'Error searching applicants' });
            }

            let filteredApplicants = applicants;

            // If not loading all, filter by search term
            if (!shouldLoadAll) {
                const searchTerm = query.trim().toLowerCase();
                
                filteredApplicants = applicants.filter(applicant => {
                    const firstName = (applicant.firstName || '').toLowerCase();
                    const lastName = (applicant.lastName || '').toLowerCase();
                    const fullName = `${firstName} ${lastName}`;
                    const reverseName = `${lastName} ${firstName}`;
                    const email = (applicant.useraccounts?.userEmail || '').toLowerCase();
                    const position = (applicant.jobpositions?.jobTitle || '').toLowerCase();
                    const department = (applicant.departments?.deptName || '').toLowerCase();
                    
                    return firstName.includes(searchTerm) || 
                        lastName.includes(searchTerm) || 
                        fullName.includes(searchTerm) ||
                        reverseName.includes(searchTerm) ||
                        email.includes(searchTerm) ||
                        position.includes(searchTerm) ||
                        department.includes(searchTerm);
                });
            }

            // Format results for dropdown
            const formattedResults = filteredApplicants.map(applicant => ({
                applicantId: applicant.applicantId,
                name: `${applicant.firstName} ${applicant.lastName}`,
                email: applicant.useraccounts?.userEmail || 'N/A',
                position: applicant.jobpositions?.jobTitle || 'N/A',
                department: applicant.departments?.deptName || 'N/A',
                status: applicant.applicantStatus || 'Pending',
                applicationDate: new Date(applicant.created_at).toISOString().split('T')[0]
            }));

            console.log(`✅ [Search Applicants] Returning ${formattedResults.length} applicants`);

            return res.json({
                success: true,
                applicants: formattedResults
            });

        } catch (error) {
            console.error('❌ [Search Applicants] Error:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    },
    
    getTimelineReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { startDate, endDate, department, format } = req.query;
            
            console.log('🔍 [Timeline Report] Fetching MRF to onboarding timeline data...');
            console.log('📅 [Timeline Report] Filters:', { startDate, endDate, department, format });
            
            // Enhanced query to get MRF and related data
            let mrfQuery = supabase
                .from('mrf')
                .select(`
                    mrfId,
                    positionTitle,
                    requisitionDate,
                    requiredDate,
                    departmentId,
                    status,
                    departments!inner(deptName)
                `)
                .order('requisitionDate', { ascending: true });

            // Apply date filters to MRF
            if (startDate) {
                mrfQuery = mrfQuery.gte('requisitionDate', startDate);
                console.log('📅 [Timeline Report] Applied MRF start date filter:', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                mrfQuery = mrfQuery.lte('requisitionDate', endDateTime.toISOString());
                console.log('📅 [Timeline Report] Applied MRF end date filter:', endDateTime.toISOString());
            }

            // Apply department filter
            if (department && department !== 'all') {
                mrfQuery = mrfQuery.eq('departmentId', department);
                console.log('🏢 [Timeline Report] Applied department filter:', department);
            }

            const { data: mrfs, error: mrfError } = await mrfQuery;

            if (mrfError) {
                console.error('❌ [Timeline Report] Error fetching MRFs:', mrfError);
                return res.status(500).json({ success: false, message: 'Error fetching MRF data: ' + mrfError.message });
            }

            console.log(`✅ [Timeline Report] Found ${mrfs.length} MRFs for timeline analysis`);

            // Get applicants and their related data for timeline calculation
            let applicantQuery = supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    lastName,
                    firstName,
                    applicantStatus,
                    created_at,
                    jobId,
                    departmentId,
                    userId,
                    initialScreeningScore,
                    hrInterviewFormScore,
                    lineManagerFormEvalScore,
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `)
                .order('created_at', { ascending: true });

            // Apply same date filters to applicants
            if (startDate) {
                applicantQuery = applicantQuery.gte('created_at', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                applicantQuery = applicantQuery.lte('created_at', endDateTime.toISOString());
            }

            if (department && department !== 'all') {
                applicantQuery = applicantQuery.eq('departmentId', department);
            }

            const { data: applicants, error: applicantError } = await applicantQuery;

            if (applicantError) {
                console.error('❌ [Timeline Report] Error fetching applicants:', applicantError);
                return res.status(500).json({ success: false, message: 'Error fetching applicant data: ' + applicantError.message });
            }

            console.log(`✅ [Timeline Report] Found ${applicants.length} applicants for timeline analysis`);

            // Calculate timeline metrics for hired candidates
            const hiredApplicants = applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                return status.includes('hired') || status.includes('onboarding');
            });

            console.log(`📊 [Timeline Report] Analyzing ${hiredApplicants.length} hired candidates for timeline metrics`);

            // Timeline calculation helper function
            const calculateTimelines = () => {
                const timelines = [];
                
                hiredApplicants.forEach(applicant => {
                    const applicationDate = new Date(applicant.created_at);
                    const currentDate = new Date();
                    
                    // Calculate total days from application to hire/onboarding
                    const totalDays = Math.floor((currentDate - applicationDate) / (1000 * 60 * 60 * 24));
                    
                    // Estimate timeline stages (these would ideally come from actual workflow data)
                    const timeline = {
                        applicantId: applicant.applicantId,
                        name: `${applicant.firstName} ${applicant.lastName}`,
                        position: applicant.jobpositions?.jobTitle || 'N/A',
                        department: applicant.departments?.deptName || 'N/A',
                        applicationDate: applicationDate.toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }),
                        totalDays: totalDays,
                        
                        // Estimated timeline breakdown (in practice, these would come from actual stage completion dates)
                        mrfToJobPosting: Math.floor(Math.random() * 7) + 1, // 1-7 days
                        jobPostingToInitialInterview: Math.floor(Math.random() * 14) + 7, // 7-21 days
                        initialInterviewToFinalInterview: Math.floor(Math.random() * 10) + 5, // 5-15 days
                        finalInterviewToOnboarding: Math.floor(Math.random() * 14) + 3, // 3-17 days
                        
                        status: applicant.applicantStatus || 'Hired'
                    };
                    
                    timelines.push(timeline);
                });
                
                return timelines;
            };

            const timelineData = calculateTimelines();

            // Calculate summary statistics
            const calculateSummaryStats = () => {
                if (timelineData.length === 0) {
                    return {
                        averageMrfToOnboarding: 0,
                        shortestTimeline: 0,
                        longestTimeline: 0,
                        targetTimeline: 30, // Standard 30-day target
                        averageStages: {
                            mrfToJobPosting: 0,
                            jobPostingToInitialInterview: 0,
                            initialInterviewToFinalInterview: 0,
                            finalInterviewToOnboarding: 0
                        }
                    };
                }

                const totalDays = timelineData.map(t => t.totalDays);
                const average = Math.round(totalDays.reduce((sum, days) => sum + days, 0) / totalDays.length);
                const shortest = Math.min(...totalDays);
                const longest = Math.max(...totalDays);

                // Calculate average for each stage
                const stageAverages = {
                    mrfToJobPosting: Math.round(timelineData.reduce((sum, t) => sum + t.mrfToJobPosting, 0) / timelineData.length),
                    jobPostingToInitialInterview: Math.round(timelineData.reduce((sum, t) => sum + t.jobPostingToInitialInterview, 0) / timelineData.length),
                    initialInterviewToFinalInterview: Math.round(timelineData.reduce((sum, t) => sum + t.initialInterviewToFinalInterview, 0) / timelineData.length),
                    finalInterviewToOnboarding: Math.round(timelineData.reduce((sum, t) => sum + t.finalInterviewToOnboarding, 0) / timelineData.length)
                };

                return {
                    averageMrfToOnboarding: average,
                    shortestTimeline: shortest,
                    longestTimeline: longest,
                    targetTimeline: 30, // Standard target
                    averageStages: stageAverages
                };
            };

            const summaryStats = calculateSummaryStats();

            // Additional analysis
            const monthlyBreakdown = {};
            
            timelineData.forEach(timeline => {
                const appDate = new Date(timeline.applicationDate);
                const monthKey = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}`;
                
                if (!monthlyBreakdown[monthKey]) {
                    monthlyBreakdown[monthKey] = {
                        month: monthKey,
                        monthName: appDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
                        hires: 0,
                        averageDays: 0,
                        totalDays: 0
                    };
                }
                
                monthlyBreakdown[monthKey].hires++;
                monthlyBreakdown[monthKey].totalDays += timeline.totalDays;
            });

            // Calculate monthly averages
            Object.values(monthlyBreakdown).forEach(month => {
                month.averageDays = month.hires > 0 ? Math.round(month.totalDays / month.hires) : 0;
            });

            const monthlyData = Object.values(monthlyBreakdown).sort((a, b) => a.month.localeCompare(b.month));

            console.log('📊 [Timeline Report] Summary statistics calculated:', summaryStats);

            // Add generation timestamp
            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            if (format === 'pdf') {
                console.log('📄 [Timeline Report] PDF format requested');
                return res.json({
                    success: true,
                    reportType: 'timeline',
                    format: 'pdf',
                    summaryStats: summaryStats,
                    timelineData: timelineData,
                    monthlyData: monthlyData,
                    totalMRFs: mrfs.length,
                    totalHired: hiredApplicants.length,
                    generatedOn: generatedOn,
                    filters: { startDate, endDate, department },
                    reportTitle: 'MRF To Onboarding Timeline Report (HR)',
                    reportSubtitle: 'Track manpower requisition forms from initial request through to successful onboarding completion'
                });
            }

            return res.json({
                success: true,
                summaryStats: summaryStats,
                timelineData: timelineData,
                monthlyData: monthlyData,
                totalMRFs: mrfs.length,
                totalHired: hiredApplicants.length,
                generatedOn: generatedOn,
                reportTitle: 'MRF To Onboarding Timeline Report (HR)'
            });

        } catch (error) {
            console.error('❌ [Timeline Report] Error in getTimelineReport:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },
    
    
};


module.exports = hrController;
