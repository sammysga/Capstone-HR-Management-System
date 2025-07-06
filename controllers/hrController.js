const { render } = require('ejs');
const supabase = require('../public/config/supabaseClient');
require('dotenv').config(); // To load environment variables
const bcrypt = require('bcrypt');
const { parse } = require('dotenv');
const flash = require('connect-flash/lib/flash');
const applicantController = require('../controllers/applicantController');
const { check } = require('express-validator');
const { getEmailTemplateData } = require('../utils/emailService');
const { sendEmail } = require('../utils/emailService');
const nodemailer = require('nodemailer');

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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

// Helper function to process attendance data for daily report
async function processAttendanceData(attendanceData, leaveData, allEmployees, reportDate) {
    const departments = ['HR', 'IT', 'Marketing', 'Partnerships', 'Investor Relations', 'Finance'];
    
    // Create employee lookup
    const employeeLookup = {};
    allEmployees.forEach(emp => {
        if (emp.staffaccounts && emp.staffaccounts.length > 0) {
            const staff = emp.staffaccounts[0];
            employeeLookup[emp.userId] = {
                firstName: staff.firstName,
                lastName: staff.lastName,
                department: staff.departments?.deptName || 'Unknown'
            };
        }
    });

    // Create leave lookup
    const leaveLookup = {};
    if (leaveData && leaveData.length > 0) {
        leaveData.forEach(leave => {
            leaveLookup[leave.userId] = {
                leaveType: leave.leave_types?.typeName || 'Leave',
                fromDate: leave.fromDate,
                untilDate: leave.untilDate
            };
        });
    }

    // Process attendance logs
    const employeeAttendance = {};
    if (attendanceData && attendanceData.length > 0) {
        attendanceData.forEach(log => {
            const userId = log.userId;
            
            if (!employeeAttendance[userId]) {
                employeeAttendance[userId] = {
                    userId,
                    timeIn: null,
                    timeOut: null,
                    useraccounts: log.useraccounts
                };
            }

            if (log.attendanceAction === 'Time In') {
                employeeAttendance[userId].timeIn = log.attendanceTime;
            } else if (log.attendanceAction === 'Time Out') {
                employeeAttendance[userId].timeOut = log.attendanceTime;
            }
        });
    }

    // Initialize summary and breakdown
    const summary = {
        totalEmployees: Object.keys(employeeLookup).length,
        present: 0,
        onLeave: 0,
        late: 0,
        earlyOut: 0,
        absent: 0
    };

    const departmentBreakdown = {};
    departments.forEach(dept => {
        departmentBreakdown[dept] = {
            department: dept,
            totalEmployees: 0,
            present: 0,
            late: 0,
            onLeave: 0,
            earlyOut: 0,
            absent: 0
        };
    });

    // Count employees per department
    Object.values(employeeLookup).forEach(emp => {
        const dept = emp.department;
        if (departmentBreakdown[dept]) {
            departmentBreakdown[dept].totalEmployees++;
        }
    });

    // Process detailed attendance by department
    const detailedAttendance = {};
    departments.forEach(dept => {
        detailedAttendance[dept] = [];
    });

    // Process each employee
    Object.keys(employeeLookup).forEach(userId => {
        const employee = employeeLookup[userId];
        const attendance = employeeAttendance[userId];
        const leave = leaveLookup[userId];
        const department = employee.department;

        let status = 'Absent';
        let hoursWorked = 'N/A';
        let timeIn = 'N/A';
        let timeOut = 'N/A';
        let lateMinutes = 0;
        let earlyOutMinutes = 0;
        let onLeave = false;
        let leaveRemarks = 'N/A';

        // Check if employee is on leave
        if (leave) {
            status = 'On Leave';
            onLeave = true;
            leaveRemarks = leave.leaveType;
            summary.onLeave++;
            if (departmentBreakdown[department]) {
                departmentBreakdown[department].onLeave++;
            }
        } else if (attendance && attendance.timeIn) {
            // Employee has attendance record
            status = 'Present';
            timeIn = attendance.timeIn;
            summary.present++;
            if (departmentBreakdown[department]) {
                departmentBreakdown[department].present++;
            }

            // Check if late (after 9:00 AM)
            const timeInParts = attendance.timeIn.split(':');
            const timeInHour = parseInt(timeInParts[0]);
            const timeInMinute = parseInt(timeInParts[1]);
            
            if (timeInHour > 9 || (timeInHour === 9 && timeInMinute > 0)) {
                lateMinutes = (timeInHour - 9) * 60 + timeInMinute;
                status = 'Late';
                summary.late++;
                summary.present--; // Remove from present count
                if (departmentBreakdown[department]) {
                    departmentBreakdown[department].late++;
                    departmentBreakdown[department].present--;
                }
            }

            // Calculate working hours
            if (attendance.timeOut) {
                timeOut = attendance.timeOut;
                
                // Simple hour calculation
                const timeInHours = timeInHour + (timeInMinute / 60);
                const timeOutParts = attendance.timeOut.split(':');
                const timeOutHours = parseInt(timeOutParts[0]) + (parseInt(timeOutParts[1]) / 60);
                
                let workingHours = timeOutHours - timeInHours;
                if (workingHours < 0) workingHours += 24; // Handle next day
                
                hoursWorked = workingHours.toFixed(1) + ' hrs';

                // Check if early out (before 5:00 PM)
                const timeOutHour = parseInt(timeOutParts[0]);
                const timeOutMinute = parseInt(timeOutParts[1]);
                
                if (timeOutHour < 17 || (timeOutHour === 17 && timeOutMinute === 0)) {
                    earlyOutMinutes = (17 - timeOutHour) * 60 - timeOutMinute;
                    if (status === 'Present') {
                        status = 'Early Out';
                    }
                    summary.earlyOut++;
                    if (departmentBreakdown[department]) {
                        departmentBreakdown[department].earlyOut++;
                    }
                }
            } else {
                timeOut = '(In Work)';
                hoursWorked = 'In progress';
            }
        } else {
            // No attendance record and not on leave
            summary.absent++;
            if (departmentBreakdown[department]) {
                departmentBreakdown[department].absent++;
            }
        }

        const employeeData = {
            lastName: employee.lastName,
            firstName: employee.firstName,
            timeIn,
            timeOut,
            hoursWorked,
            status,
            lateMinutes,
            earlyOutMinutes,
            onLeave,
            leaveRemarks
        };

        if (detailedAttendance[department]) {
            detailedAttendance[department].push(employeeData);
        }
    });

    // Sort employees within each department
    Object.keys(detailedAttendance).forEach(dept => {
        detailedAttendance[dept].sort((a, b) => 
            `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
        );
    });

    return {
        summary,
        departmentBreakdown: Object.values(departmentBreakdown),
        detailedAttendance
    };
}

// Helper function: Calculate date range based on time period
function calculateDateRange(timePeriod) {
    const now = new Date();
    let startDate, endDate = now;
    
    switch (timePeriod) {
        case 'thisYear':
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
        case 'lastYear':
            startDate = new Date(now.getFullYear() - 1, 0, 1);
            endDate = new Date(now.getFullYear() - 1, 11, 31);
            break;
        case 'last6Months':
            startDate = new Date(now.getTime() - (6 * 30 * 24 * 60 * 60 * 1000));
            break;
        case 'last3Months':
            startDate = new Date(now.getTime() - (3 * 30 * 24 * 60 * 60 * 1000));
            break;
        default:
            startDate = new Date(now.getFullYear(), 0, 1);
    }
    
    return { startDate, endDate };
}

// Helper function: Get training needs vs completion data
async function getTrainingNeedsVsCompletion(dateRange, departmentFilter, categoryFilter) {
    try {
        console.log('📊 Fetching training needs vs completion data...');
        
        // This is a simplified version - you'll need to adapt based on how you store training requirements
        // For now, we'll use training categories from completed trainings as a proxy
        
        let query = supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                status,
                isApproved,
                dateRequested,
                training_records_categories!inner (
                    training_categories!inner (
                        category
                    )
                ),
                useraccounts!inner (
                    staffaccounts!inner (
                        departments!inner (
                            deptName
                        )
                    )
                )
            `)
            .gte('dateRequested', dateRange.startDate.toISOString().split('T')[0])
            .lte('dateRequested', dateRange.endDate.toISOString().split('T')[0]);
        
        const { data: trainingRecords, error } = await query;
        
        if (error) {
            console.error('Error fetching training records:', error);
            return [];
        }
        
        // Group by category and calculate completion rates
        const categoryStats = {};
        
        trainingRecords.forEach(record => {
            const category = record.training_records_categories?.[0]?.training_categories?.category || 'Other';
            const department = record.useraccounts?.staffaccounts?.[0]?.departments?.deptName || 'Unknown';
            
            // Apply filters
            if (departmentFilter && department !== departmentFilter) return;
            if (categoryFilter && category !== categoryFilter) return;
            
            if (!categoryStats[category]) {
                categoryStats[category] = {
                    category,
                    required: 0,
                    completed: 0
                };
            }
            
            categoryStats[category].required++;
            
            // Count as completed if approved and status indicates completion
            if (record.isApproved && (record.status === 'Completed' || record.status === 'In Progress')) {
                categoryStats[category].completed++;
            }
        });
        
        return Object.values(categoryStats);
        
    } catch (error) {
        console.error('Error in getTrainingNeedsVsCompletion:', error);
        return [];
    }
}

// Helper function: Get performance improvement data  
async function getPerformanceImprovementData(dateRange, departmentFilter) {
    try {
        console.log('📊 Fetching performance improvement data...');
        
        // This is a simplified version - you'd need to connect to actual performance evaluation data
        // For now, we'll create sample data based on training completion patterns
        
        const { data: trainingRecords, error } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                dateRequested,
                status,
                isApproved,
                useraccounts!inner (
                    staffaccounts!inner (
                        departments!inner (
                            deptName
                        )
                    )
                )
            `)
            .eq('isApproved', true)
            .gte('dateRequested', dateRange.startDate.toISOString().split('T')[0])
            .lte('dateRequested', dateRange.endDate.toISOString().split('T')[0]);
            
        if (error) {
            console.error('Error fetching training records:', error);
            return [];
        }
        
        // Group by month and calculate average improvement
        const monthlyStats = {};
        
        trainingRecords.forEach(record => {
            const department = record.useraccounts?.staffaccounts?.[0]?.departments?.deptName;
            
            if (departmentFilter && department !== departmentFilter) return;
            
            const month = new Date(record.dateRequested).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short' 
            });
            
            if (!monthlyStats[month]) {
                monthlyStats[month] = {
                    month,
                    trainingCount: 0,
                    avgImprovement: 0
                };
            }
            
            monthlyStats[month].trainingCount++;
            // Simulate performance improvement based on training completion
            // In real implementation, you'd join with performance evaluation data
            monthlyStats[month].avgImprovement = Math.min(25, monthlyStats[month].trainingCount * 2.5);
        });
        
        return Object.values(monthlyStats).sort((a, b) => new Date(a.month) - new Date(b.month));
        
    } catch (error) {
        console.error('Error in getPerformanceImprovementData:', error);
        return [];
    }
}

// Helper function: Get training effectiveness data
async function getTrainingEffectivenessData(dateRange, categoryFilter) {
    try {
        console.log('📊 Fetching training effectiveness data...');
        
        const { data: trainingRecords, error } = await supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                status,
                isApproved,
                training_records_categories!inner (
                    training_categories!inner (
                        category
                    )
                )
            `)
            .eq('isApproved', true)
            .gte('dateRequested', dateRange.startDate.toISOString().split('T')[0])
            .lte('dateRequested', dateRange.endDate.toISOString().split('T')[0]);
            
        if (error) {
            console.error('Error fetching training records:', error);
            return [];
        }
        
        // Group by category and calculate success rates
        const categoryEffectiveness = {};
        
        trainingRecords.forEach(record => {
            const category = record.training_records_categories?.[0]?.training_categories?.category || 'Other';
            
            if (categoryFilter && category !== categoryFilter) return;
            
            if (!categoryEffectiveness[category]) {
                categoryEffectiveness[category] = {
                    category,
                    totalTrainings: 0,
                    successfulTrainings: 0,
                    successRate: 0
                };
            }
            
            categoryEffectiveness[category].totalTrainings++;
            
            // Consider it successful if completed
            if (record.status === 'Completed') {
                categoryEffectiveness[category].successfulTrainings++;
            }
        });
        
        // Calculate success rates
        Object.values(categoryEffectiveness).forEach(cat => {
            cat.successRate = cat.totalTrainings > 0 ? 
                Math.round((cat.successfulTrainings / cat.totalTrainings) * 100) : 0;
        });
        
        return Object.values(categoryEffectiveness);
        
    } catch (error) {
        console.error('Error in getTrainingEffectivenessData:', error);
        return [];
    }
}

// Helper function: Get category distribution data
async function getCategoryDistributionData(dateRange, departmentFilter) {
    try {
        console.log('📊 Fetching category distribution data...');
        
        let query = supabase
            .from('training_records')
            .select(`
                trainingRecordId,
                training_records_categories!inner (
                    training_categories!inner (
                        category
                    )
                ),
                useraccounts!inner (
                    staffaccounts!inner (
                        departments!inner (
                            deptName
                        )
                    )
                )
            `)
            .eq('isApproved', true)
            .gte('dateRequested', dateRange.startDate.toISOString().split('T')[0])
            .lte('dateRequested', dateRange.endDate.toISOString().split('T')[0]);
            
        const { data: trainingRecords, error } = await query;
        
        if (error) {
            console.error('Error fetching training records:', error);
            return [];
        }
        
        // Count by category
        const categoryCount = {};
        
        trainingRecords.forEach(record => {
            const category = record.training_records_categories?.[0]?.training_categories?.category || 'Other';
            const department = record.useraccounts?.staffaccounts?.[0]?.departments?.deptName;
            
            if (departmentFilter && department !== departmentFilter) return;
            
            categoryCount[category] = (categoryCount[category] || 0) + 1;
        });
        
        return Object.entries(categoryCount).map(([category, count]) => ({
            category,
            count
        })).sort((a, b) => b.count - a.count);
        
    } catch (error) {
        console.error('Error in getCategoryDistributionData:', error);
        return [];
    }
}

// Helper function: Get department gap analysis
async function getDepartmentGapAnalysis(dateRange) {
    try {
        console.log('📊 Fetching department gap analysis...');
        
        // Get all departments
        const { data: departments, error: deptError } = await supabase
            .from('departments')
            .select('departmentId, deptName');
            
        if (deptError) {
            console.error('Error fetching departments:', deptError);
            return [];
        }
        
        // For each department, calculate training gaps
        const departmentGaps = await Promise.all(departments.map(async (dept) => {
            const { data: trainingRecords, error } = await supabase
                .from('training_records')
                .select(`
                    trainingRecordId,
                    status,
                    isApproved,
                    useraccounts!inner (
                        staffaccounts!inner (
                            departmentId
                        )
                    )
                `)
                .eq('useraccounts.staffaccounts.departmentId', dept.departmentId)
                .gte('dateRequested', dateRange.startDate.toISOString().split('T')[0])
                .lte('dateRequested', dateRange.endDate.toISOString().split('T')[0]);
                
            if (error) {
                console.error(`Error fetching training records for dept ${dept.departmentId}:`, error);
                return {
                    departmentId: dept.departmentId,
                    departmentName: dept.deptName,
                    required: 0,
                    completed: 0
                };
            }
            
            const required = trainingRecords.length;
            const completed = trainingRecords.filter(record => 
                record.isApproved && record.status === 'Completed'
            ).length;
            
            return {
                departmentId: dept.departmentId,
                departmentName: dept.deptName,
                required,
                completed
            };
        }));
        
        return departmentGaps.filter(dept => dept.required > 0);
        
    } catch (error) {
        console.error('Error in getDepartmentGapAnalysis:', error);
        return [];
    }
}

// Helper function: Get budget recommendations
async function getBudgetRecommendationsData() {
    try {
        console.log('📊 Generating budget recommendations...');
        
        // Get department gap analysis to base recommendations on
        const departmentGaps = await getDepartmentGapAnalysis({ 
            startDate: new Date(new Date().getFullYear(), 0, 1), 
            endDate: new Date() 
        });
        
        const recommendations = departmentGaps.map(dept => {
            const gap = dept.required - dept.completed;
            const completionRate = dept.required > 0 ? (dept.completed / dept.required) * 100 : 100;
            
            let type, recommendedAmount, reason, expectedImpact;
            
            if (completionRate < 50 && gap > 10) {
                type = 'increase';
                recommendedAmount = gap * 15000; // Estimate ₱15k per training
                reason = `Low completion rate (${Math.round(completionRate)}%) with ${gap} training gap. Significant investment needed.`;
                expectedImpact = `Potential to improve completion rate to 80%+ and close training gaps.`;
            } else if (completionRate < 75 && gap > 5) {
                type = 'increase';
                recommendedAmount = gap * 12000;
                reason = `Moderate completion rate (${Math.round(completionRate)}%) with ${gap} training gap. Budget increase recommended.`;
                expectedImpact = `Expected completion rate improvement to 85%+.`;
            } else if (completionRate > 90 && gap < 2) {
                type = 'decrease';
                recommendedAmount = dept.required * 8000; // Reduced amount
                reason = `High completion rate (${Math.round(completionRate)}%) with minimal gaps. Budget can be optimized.`;
                expectedImpact = `Maintain high performance while optimizing costs. Savings can be reallocated.`;
            } else {
                type = 'maintain';
                recommendedAmount = dept.required * 10000; // Average amount
                reason = `Balanced completion rate (${Math.round(completionRate)}%). Current budget allocation is appropriate.`;
                expectedImpact = `Maintain current performance levels with steady investment.`;
            }
            
            return {
                department: dept.departmentName,
                type,
                recommendedAmount,
                reason,
                expectedImpact
            };
        });
        
        // Sort by recommended amount (highest first)
        return recommendations.sort((a, b) => b.recommendedAmount - a.recommendedAmount);
        
    } catch (error) {
        console.error('Error in getBudgetRecommendationsData:', error);
        return [];
    }
}

// Helper function: Get unique departments
async function getUniqueDepartments() {
    try {
        const { data: departments, error } = await supabase
            .from('departments')
            .select('deptName')
            .order('deptName');
            
        if (error) {
            console.error('Error fetching departments:', error);
            return [];
        }
        
        return departments.map(dept => dept.deptName);
        
    } catch (error) {
        console.error('Error in getUniqueDepartments:', error);
        return [];
    }
}

// Helper function: Get unique categories
async function getUniqueCategories() {
    try {
        const { data: categories, error } = await supabase
            .from('training_categories')
            .select('category')
            .order('category');
            
        if (error) {
            console.error('Error fetching categories:', error);
            return [];
        }
        
        return categories.map(cat => cat.category);
        
    } catch (error) {
        console.error('Error in getUniqueCategories:', error);
        return [];
    }
}

// Helper function: Calculate summary metrics
function calculateSummaryMetrics(needsData, performanceData, effectivenessData, categoryData) {
    const totalRequired = needsData.reduce((sum, item) => sum + item.required, 0);
    const totalCompleted = needsData.reduce((sum, item) => sum + item.completed, 0);
    const completionRate = totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : 0;
    
    const avgPerformanceImprovement = performanceData.length > 0 ? 
        Math.round(performanceData.reduce((sum, item) => sum + item.avgImprovement, 0) / performanceData.length) : 0;
        
    const avgEffectiveness = effectivenessData.length > 0 ?
        Math.round(effectivenessData.reduce((sum, item) => sum + item.successRate, 0) / effectivenessData.length) : 0;
        
    const totalCompletedTrainings = categoryData.reduce((sum, item) => sum + item.count, 0);
    
    return {
        completionRate,
        avgPerformanceImprovement,
        avgEffectiveness,
        totalCompletedTrainings
    };
}


    async function updateP2StatusesAfterEmails(passedApplicantIds, failedApplicantIds) {
    const updatePromises = [];
    
    // Update passed applicants to P3 - Awaiting for Line Manager Evaluation
    for (const applicantId of passedApplicantIds) {
        // First get the userId from applicantId
        const { data: applicantData } = await supabase
            .from('applicants')
            .select('userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (applicantData && applicantData.userId) {
            const userId = applicantData.userId;
            
            updatePromises.push(
                supabase
                    .from('applicants')
                    .update({ applicantStatus: 'P3 - Awaiting for Line Manager Evaluation' })
                    .eq('applicantId', applicantId)
            );
            
            // Add chatbot message for passed applicants
            updatePromises.push(
                supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: "Congratulations! You have successfully passed the HR interview and advanced to the final interview stage with our Line Manager." }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P2 - PASSED'
                    }])
            );
        }
    }
    
    // Update failed applicants to P2 - FAILED
    for (const applicantId of failedApplicantIds) {
        // First get the userId from applicantId
        const { data: applicantData } = await supabase
            .from('applicants')
            .select('userId')
            .eq('applicantId', applicantId)
            .single();
            
        if (applicantData && applicantData.userId) {
            const userId = applicantData.userId;
            
            updatePromises.push(
                supabase
                    .from('applicants')
                    .update({ applicantStatus: 'P2 - FAILED' })
                    .eq('applicantId', applicantId)
            );
            
            // Add chatbot message for failed applicants
            updatePromises.push(
                supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ text: "Thank you for participating in our HR interview process. We regret to inform you that we will not be proceeding with your application at this time." }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P2 - FAILED'
                    }])
            );
        }
    }
    
    await Promise.all(updatePromises);
}

// Send P2 email using your existing email templates
async function sendP2EmailWithTemplate(email, templateType, applicantName, jobTitle) {
    try {
        console.log(`📧 HR P2: Sending ${templateType} email to: ${email}`);
        
        const template = emailTemplates[templateType];
        if (!template) {
            throw new Error(`P2 template '${templateType}' not found`);
        }

        // Use the getHtml function from your email templates
        const htmlContent = template.getHtml(applicantName, jobTitle);
        const subject = template.subject;

        // Use your existing sendEmail function
        const result = await sendEmail(email, subject, htmlContent);
        
        console.log(`✅ HR P2: Email sent successfully: ${templateType} to ${email}`);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error(`❌ HR P2: Error sending email (${templateType}) to ${email}:`, error);
        return { success: false, error: error.message };
    }
}

// Function to send welcome email to new staff
async function sendWelcomeEmail(staffData) {
    const { email, firstName, lastName, userRole, department, jobTitle, password } = staffData;
    
    const mailOptions = {
        from: {
            name: 'HR Department',
            address: process.env.EMAIL_USER
        },
        to: email,
        subject: 'Welcome to the Company ABC Team - Your Account Details',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 600px;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    .header {
                        background-color: #2385B0;
                        color: white;
                        padding: 20px;
                        text-align: center;
                        border-radius: 8px 8px 0 0;
                    }
                    .content {
                        background-color: #f9f9f9;
                        padding: 30px;
                        border-radius: 0 0 8px 8px;
                        border: 1px solid #ddd;
                        border-top: none;
                    }
                    .welcome-text {
                        font-size: 18px;
                        margin-bottom: 20px;
                    }
                    .details-box {
                        background-color: white;
                        padding: 20px;
                        border-radius: 6px;
                        border-left: 4px solid #2385B0;
                        margin: 20px 0;
                    }
                    .detail-row {
                        display: flex;
                        margin: 10px 0;
                        padding: 8px 0;
                        border-bottom: 1px solid #eee;
                    }
                    .detail-label {
                        font-weight: bold;
                        width: 140px;
                        color: #2385B0;
                    }
                    .detail-value {
                        flex: 1;
                    }
                    .password-highlight {
                        background-color: #fff3cd;
                        padding: 15px;
                        border-radius: 4px;
                        border-left: 4px solid #ffc107;
                        margin: 20px 0;
                    }
                    .password-text {
                        font-family: 'Courier New', monospace;
                        font-size: 16px;
                        font-weight: bold;
                        color: #856404;
                        background-color: white;
                        padding: 8px 12px;
                        border-radius: 4px;
                        display: inline-block;
                        margin-top: 8px;
                    }
                    .instructions {
                        background-color: #d4edda;
                        padding: 15px;
                        border-radius: 4px;
                        border-left: 4px solid #28a745;
                        margin: 20px 0;
                    }
                    .footer {
                        text-align: center;
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid #ddd;
                        color: #666;
                        font-size: 14px;
                    }
                    .button {
                        display: inline-block;
                        background-color: #2385B0;
                        color: white;
                        padding: 12px 24px;
                        text-decoration: none;
                        border-radius: 4px;
                        margin: 15px 0;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Welcome to the Company ABC Team!</h1>
                </div>
                
                <div class="content">
                    <div class="welcome-text">
                        Dear ${firstName} ${lastName},
                    </div>
                    
                    <p>We're excited to welcome you to our team! Your staff account has been successfully created. Below are your account details and login information.</p>
                    
                    <div class="details-box">
                        <h3 style="margin-top: 0; color: #2385B0;">Your Account Details</h3>
                        
                        <div class="detail-row">
                            <div class="detail-label">Full Name:</div>
                            <div class="detail-value">${firstName} ${lastName}</div>
                        </div>
                        
                        <div class="detail-row">
                            <div class="detail-label">Email:</div>
                            <div class="detail-value">${email}</div>
                        </div>
                        
                        <div class="detail-row">
                            <div class="detail-label">Department:</div>
                            <div class="detail-value">${department}</div>
                        </div>
                        
                        <div class="detail-row">
                            <div class="detail-label">Job Title:</div>
                            <div class="detail-value">${jobTitle}</div>
                        </div>
                        
                        <div class="detail-row">
                            <div class="detail-label">Role:</div>
                            <div class="detail-value">${userRole}</div>
                        </div>
                    </div>
                    
                    <div class="password-highlight">
                        <strong>⚠️ Important - Your Login Password:</strong>
                        <div class="password-text">${password}</div>
                        <p style="margin-bottom: 0; font-size: 14px;">
                            <strong>Please save this password securely.</strong> You'll need it to log into your account.
                        </p>
                    </div>
                    
                    <div class="instructions">
                        <h4 style="margin-top: 0; color: #155724;">Next Steps:</h4>
                        <ol style="margin-bottom: 0;">
                            <li>Save your login credentials in a secure location</li>
                            <li>Use your email address and the password above to log in</li>
                            <li>Change your password after your first login for security</li>
                            <li>Contact HR if you have any questions or issues accessing your account</li>
                        </ol>
                    </div>
                    
                    <p>If you have any questions or need assistance, please don't hesitate to contact our HR department.</p>
                    
                    <p>We look forward to working with you!</p>
                    
                    <div class="footer">
                        <p><strong>Company ABC HR Department</strong><br>
                        This is an automated message. Please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Welcome email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending welcome email:', error);
        return { success: false, error: error.message };
    }
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

    // ============================================================================
    // MAIN HR DASHBOARD - Show pending training requests for approval
    // ============================================================================
    getHrTrainingDevelopmentTracker: async function (req, res) {
        try {
            console.log('Loading HR Training Dashboard...');

            // Get all training requests that need HR approval
            const pendingRequests = await hrController.getPendingTrainingRequests();
            
            // Get budget overview for decision making
            const budgetData = await hrController.getBudgetOverviewData();
            
            res.render('staffpages/hr_pages/hrtrainingdevelopmenttracker', {
                title: 'HR Training Approvals',
                pendingRequests: pendingRequests,
                budgetData: budgetData,
                user: req.user || null
            });
            
        } catch (error) {
            console.error('Error loading HR dashboard:', error);
            res.status(500).send('Error loading dashboard');
        }
    },

    // ============================================================================
    // GET PENDING TRAINING REQUESTS - Only "For HR Approval" status
    // ============================================================================
    getPendingTrainingRequests: async function (req, res = null) {
        try {
            console.log('Fetching pending training requests...');

            const { data: requests, error } = await supabase
                .from('training_records')
                .select(`
                    *,
                    useraccounts!training_records_userId_fkey (
                        userId,
                        userEmail
                    )
                `)
                .eq('status', 'For HR Approval')
                .order('dateRequested', { ascending: false });

            if (error) throw error;

            // Get all user IDs from the requests
            const userIds = requests?.map(req => req.userId) || [];
            
            if (userIds.length === 0) {
                console.log('No pending requests found');
                if (res) {
                    return res.json({
                        success: true,
                        data: []
                    });
                }
                return [];
            }

            // Get all staff data for these users in one query
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select(`
                    *,
                    departments!staffaccounts_departmentId_fkey (
                        departmentId,
                        deptName
                    ),
                    jobpositions!staffaccounts_jobId_fkey (
                        jobId,
                        jobTitle
                    )
                `)
                .in('userId', userIds);

            if (staffError) throw staffError;

            // Create a lookup map
            const staffLookup = {};
            (staffData || []).forEach(staff => {
                staffLookup[staff.userId] = staff;
            });

            // Format the requests
            const formattedRequests = await Promise.all((requests || []).map(async request => {
                const staff = staffLookup[request.userId];
                
                if (!staff) {
                    console.error(`No staff data found for userId: ${request.userId}`);
                    return null;
                }

                const budgetCheck = await hrController.checkDepartmentBudget(
                    staff.departmentId || 0,
                    request.cost || 0
                );

                return {
                    requestId: request.trainingRecordId,
                    employeeName: `${staff.firstName || 'Unknown'} ${staff.lastName || 'User'}`,
                    department: staff.departments?.deptName || 'Unknown Department',
                    departmentId: staff.departmentId || 0,
                    jobTitle: staff.jobpositions?.jobTitle || 'Unknown Position',
                    trainingName: request.trainingName,
                    trainingDesc: request.trainingDesc,
                    cost: request.cost || 0,
                    requestDate: request.dateRequested,
                    lineManagerRemarks: request.lmDecisionRemarks,
                    isOnlineArrangement: request.isOnlineArrangement,
                    duration: request.totalDuration || 0,
                    country: request.country,
                    address: request.address,
                    budgetSufficient: budgetCheck.sufficient,
                    availableBudget: budgetCheck.available
                };
            }));

            // Filter out null results (where staff data wasn't found)
            const validRequests = formattedRequests.filter(request => request !== null);

            console.log(`Found ${validRequests.length} pending requests`);

            if (res) {
                return res.json({
                    success: true,
                    data: validRequests
                });
            }
            
            return validRequests;

        } catch (error) {
            console.error('Error fetching pending requests:', error);
            if (res) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch pending requests'
                });
            }
            return [];
        }
    },


    // ============================================================================
    // APPROVE/REJECT TRAINING REQUEST - Based on budget
    // ============================================================================
    approveTrainingRequest: async function (req, res) {
        try {
            const { requestId, decision, remarks } = req.body;
            
            console.log(`Processing approval for request ${requestId}: ${decision}`);

            if (!requestId || !decision || !['approved', 'rejected'].includes(decision)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid request data'
                });
            }

            // Get the training request details
            const { data: request, error: requestError } = await supabase
                .from('training_records')
                .select(`
                    *,
                    useraccounts!training_records_userId_fkey (
                        userId
                    )
                `)
                .eq('trainingRecordId', requestId)
                .single();

            if (requestError || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Training request not found'
                });
            }

            // Get staff data to find department
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('departmentId')
                .eq('userId', request.userId)
                .single();

            if (staffError || !staffData) {
                return res.status(404).json({
                    success: false,
                    message: 'Staff data not found'
                });
            }

            // If approving, check budget
            if (decision === 'approved') {
                const budgetCheck = await hrController.checkDepartmentBudget(
                    staffData.departmentId,
                    request.cost || 0
                );

                if (!budgetCheck.sufficient) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient budget. Available: ₱${budgetCheck.available}, Required: ₱${request.cost}`
                    });
                }
            }

            // Update the training request
            const newStatus = decision === 'approved' ? 'In Progress' : 'Cancelled';
            
            const { error: updateError } = await supabase
                .from('training_records')
                .update({
                    status: newStatus,
                    isApproved: decision === 'approved',
                    hrDecisionDate: new Date().toISOString(),
                    hrDecisionRemarks: remarks || `Training ${decision} by HR`
                })
                .eq('trainingRecordId', requestId);

            if (updateError) throw updateError;

            console.log(`Training request ${requestId} ${decision} successfully`);

            res.json({
                success: true,
                message: `Training request ${decision} successfully`,
                data: {
                    requestId: requestId,
                    decision: decision,
                    newStatus: newStatus
                }
            });

        } catch (error) {
            console.error('Error processing approval:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to process approval'
            });
        }
    },



    // ============================================================================
    // CHECK DEPARTMENT BUDGET - Verify if department has sufficient funds
    // ============================================================================
   checkDepartmentBudget: async function (departmentId, requestedAmount) {
        try {
            console.log(`Checking budget for department ${departmentId}, amount: ₱${requestedAmount}`);

            // Get department budget
            const { data: budget, error: budgetError } = await supabase
                .from('training_budgets')
                .select('amount')
                .eq('departmentId', departmentId)
                .single();

            if (budgetError) {
                console.log('No budget found for department, defaulting to ₱100,000');
                return {
                    sufficient: requestedAmount <= 100000,
                    available: 100000,
                    allocated: 100000,
                    spent: 0
                };
            }

            // Get spent amount - Fixed relationship
            const { data: approvedTrainings, error: spendingError } = await supabase
                .from('training_records')
                .select('userId, cost')
                .eq('isApproved', true);

            if (spendingError) throw spendingError;

            // Get user IDs from approved trainings
            const userIds = (approvedTrainings || []).map(training => training.userId);
            let totalSpent = 0;

            if (userIds.length > 0) {
                // Get staff data for these users in this department
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('userId')
                    .eq('departmentId', departmentId)
                    .in('userId', userIds);

                if (staffError) throw staffError;

                // Get user IDs for this department
                const deptUserIds = (staffData || []).map(staff => staff.userId);
                
                // Calculate total spent for this department
                totalSpent = (approvedTrainings || [])
                    .filter(training => deptUserIds.includes(training.userId))
                    .reduce((sum, training) => sum + (training.cost || 0), 0);
            }

            const available = (budget.amount || 0) - totalSpent;

            return {
                sufficient: available >= requestedAmount,
                available: available,
                allocated: budget.amount || 0,
                spent: totalSpent
            };

        } catch (error) {
            console.error('Error checking budget:', error);
            return {
                sufficient: false,
                available: 0,
                allocated: 0,
                spent: 0
            };
        }
    },

    // ============================================================================
    // BUDGET OVERVIEW - Show all department budgets and spending
    // ============================================================================
    getBudgetOverview: async function (req, res) {
        try {
            console.log('Loading budget overview...');
            
            const budgetData = await hrController.getBudgetOverviewData();
            
            res.json({
                success: true,
                data: budgetData
            });

        } catch (error) {
            console.error('Error loading budget overview:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load budget overview'
            });
        }
    },

    getBudgetOverviewData: async function () {
        try {
            // Get all departments
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('*');

            if (deptError) throw deptError;

            // Get all budgets
            const { data: budgets, error: budgetError } = await supabase
                .from('training_budgets')
                .select('*');

            if (budgetError) throw budgetError;

            // Get approved training spending - Fixed relationship
            const { data: approvedTrainings, error: spendingError } = await supabase
                .from('training_records')
                .select('userId, cost')
                .eq('isApproved', true);

            if (spendingError) throw spendingError;

            // Get all user IDs from approved trainings
            const userIds = (approvedTrainings || []).map(training => training.userId);
            
            let spendingByDept = {};
            
            if (userIds.length > 0) {
                // Get staff data for these users to determine departments
                const { data: staffData, error: staffError } = await supabase
                    .from('staffaccounts')
                    .select('userId, departmentId')
                    .in('userId', userIds);

                if (staffError) throw staffError;

                // Create user to department mapping
                const userToDept = {};
                (staffData || []).forEach(staff => {
                    userToDept[staff.userId] = staff.departmentId;
                });

                // Calculate spending per department
                (approvedTrainings || []).forEach(training => {
                    const deptId = userToDept[training.userId];
                    if (deptId) {
                        if (!spendingByDept[deptId]) spendingByDept[deptId] = 0;
                        spendingByDept[deptId] += training.cost || 0;
                    }
                });
            }

            // Combine data
            const budgetOverview = (departments || []).map(dept => {
                const budget = (budgets || []).find(b => b.departmentId === dept.departmentId);
                const spent = spendingByDept[dept.departmentId] || 0;
                const allocated = budget?.amount || 100000; // Default ₱100k
                const remaining = allocated - spent;
                const utilization = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;

                return {
                    departmentId: dept.departmentId,
                    departmentName: dept.deptName,
                    allocated: allocated,
                    spent: spent,
                    remaining: remaining,
                    utilization: utilization,
                    status: utilization >= 90 ? 'critical' : utilization >= 75 ? 'warning' : 'good'
                };
            });

            return {
                departments: budgetOverview.sort((a, b) => b.spent - a.spent),
                totalAllocated: budgetOverview.reduce((sum, dept) => sum + dept.allocated, 0),
                totalSpent: budgetOverview.reduce((sum, dept) => sum + dept.spent, 0),
                totalRemaining: budgetOverview.reduce((sum, dept) => sum + dept.remaining, 0)
            };

        } catch (error) {
            console.error('Error getting budget overview data:', error);
            return {
                departments: [],
                totalAllocated: 0,
                totalSpent: 0,
                totalRemaining: 0
            };
        }
    },

    // ============================================================================
    // UPDATE DEPARTMENT BUDGET - HR can set/update budgets
    // ============================================================================
    updateBudget: async function (req, res) {
        try {
            const { departmentId, amount, fiscalYear = 2025 } = req.body;

            console.log(`Updating budget for department ${departmentId}: ₱${amount}`);

            if (!departmentId || amount === undefined) {
                return res.status(400).json({
                    success: false,
                    message: 'Department ID and amount are required'
                });
            }

            // Check if budget exists
            const { data: existing, error: checkError } = await supabase
                .from('training_budgets')
                .select('*')
                .eq('departmentId', departmentId)
                .eq('fiscalYear', fiscalYear)
                .single();

            let result;
            if (existing) {
                // Update existing
                const { data, error } = await supabase
                    .from('training_budgets')
                    .update({ amount: parseFloat(amount) })
                    .eq('departmentId', departmentId)
                    .eq('fiscalYear', fiscalYear)
                    .select()
                    .single();

                if (error) throw error;
                result = data;
            } else {
                // Create new
                const { data, error } = await supabase
                    .from('training_budgets')
                    .insert({
                        departmentId: parseInt(departmentId),
                        amount: parseFloat(amount),
                        fiscalYear: fiscalYear
                    })
                    .select()
                    .single();

                if (error) throw error;
                result = data;
            }

            res.json({
                success: true,
                message: 'Budget updated successfully',
                data: result
            });

        } catch (error) {
            console.error('Error updating budget:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update budget'
            });
        }
    },

    // ============================================================================
    // GET TRAINING REQUEST DETAILS - For HR review
    // ============================================================================
    getTrainingRequestDetails: async function (req, res) {
        try {
            const { requestId } = req.params;

            console.log('Getting training request details:', requestId);

            const { data: request, error } = await supabase
                .from('training_records')
                .select(`
                    *,
                    useraccounts!training_records_userId_fkey (
                        userId,
                        userEmail
                    )
                `)
                .eq('trainingRecordId', requestId)
                .single();

            if (error || !request) {
                return res.status(404).json({
                    success: false,
                    message: 'Training request not found'
                });
            }

            // Get staff data
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select(`
                    *,
                    departments!staffaccounts_departmentId_fkey (
                        departmentId,
                        deptName
                    ),
                    jobpositions!staffaccounts_jobId_fkey (
                        jobId,
                        jobTitle
                    )
                `)
                .eq('userId', request.userId)
                .single();

            if (staffError || !staffData) {
                return res.status(404).json({
                    success: false,
                    message: 'Staff data not found'
                });
            }

            const formattedRequest = {
                requestId: request.trainingRecordId,
                employeeName: `${staffData.firstName || 'Unknown'} ${staffData.lastName || 'User'}`,
                department: staffData.departments?.deptName || 'Unknown Department',
                departmentId: staffData.departmentId || 0,
                jobTitle: staffData.jobpositions?.jobTitle || 'Unknown Position',
                trainingName: request.trainingName,
                trainingDesc: request.trainingDesc,
                cost: request.cost || 0,
                duration: request.totalDuration || 0,
                requestDate: request.dateRequested,
                lineManagerRemarks: request.lmDecisionRemarks,
                isOnlineArrangement: request.isOnlineArrangement,
                country: request.country,
                address: request.address,
                status: request.status
            };

            res.json({
                success: true,
                data: formattedRequest
            });

        } catch (error) {
            console.error('Error getting request details:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get request details'
            });
        }
    },


    // ============================================================================
    // GET TRAINING APPROVAL HISTORY - All HR decisions made
    // ============================================================================
    getTrainingApprovalHistory: async function (req, res) {
        try {
            console.log('Fetching training approval history...');

            const { data: history, error } = await supabase
                .from('training_records')
                .select(`
                    *,
                    useraccounts!training_records_userId_fkey (
                        userId,
                        userEmail
                    )
                `)
                .in('status', ['In Progress', 'Cancelled', 'Completed'])
                .not('hrDecisionDate', 'is', null)
                .order('hrDecisionDate', { ascending: false });

            if (error) throw error;

            // Get all user IDs from the history
            const userIds = (history || []).map(record => record.userId);
            
            if (userIds.length === 0) {
                return res.json({
                    success: true,
                    data: []
                });
            }

            // Get all staff data for these users
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select(`
                    *,
                    departments!staffaccounts_departmentId_fkey (
                        departmentId,
                        deptName
                    ),
                    jobpositions!staffaccounts_jobId_fkey (
                        jobId,
                        jobTitle
                    )
                `)
                .in('userId', userIds);

            if (staffError) throw staffError;

            // Create a lookup map
            const staffLookup = {};
            (staffData || []).forEach(staff => {
                staffLookup[staff.userId] = staff;
            });

            const formattedHistory = (history || []).map(record => {
                const staff = staffLookup[record.userId];
                
                if (!staff) {
                    console.warn(`No staff data found for userId: ${record.userId}`);
                    return {
                        requestId: record.trainingRecordId,
                        employeeName: 'Unknown User',
                        department: 'Unknown Department',
                        departmentId: 0,
                        jobTitle: 'Unknown Position',
                        trainingName: record.trainingName,
                        cost: record.cost || 0,
                        duration: record.totalDuration || 0,
                        status: record.status,
                        isApproved: record.isApproved,
                        hrDecisionDate: record.hrDecisionDate,
                        hrDecisionRemarks: record.hrDecisionRemarks,
                        isOnlineArrangement: record.isOnlineArrangement
                    };
                }

                return {
                    requestId: record.trainingRecordId,
                    employeeName: `${staff.firstName || 'Unknown'} ${staff.lastName || 'User'}`,
                    department: staff.departments?.deptName || 'Unknown Department',
                    departmentId: staff.departmentId || 0,
                    jobTitle: staff.jobpositions?.jobTitle || 'Unknown Position',
                    trainingName: record.trainingName,
                    cost: record.cost || 0,
                    duration: record.totalDuration || 0,
                    status: record.status,
                    isApproved: record.isApproved,
                    hrDecisionDate: record.hrDecisionDate,
                    hrDecisionRemarks: record.hrDecisionRemarks,
                    isOnlineArrangement: record.isOnlineArrangement
                };
            });

            console.log(`Found ${formattedHistory.length} approval history records`);

            res.json({
                success: true,
                data: formattedHistory
            });

        } catch (error) {
            console.error('Error fetching approval history:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch approval history'
            });
        }
    },

    getTrainingAnalytics: async function (req, res) {
        try {
            console.log('📊 Loading training analytics data...');
            
            // Get query parameters for filtering (optional)
            const { 
                department, 
                category, 
                timePeriod = 'thisYear' 
            } = req.query;
            
            // Calculate date range based on time period
            const dateRange = calculateDateRange(timePeriod);
            
            // Fetch all required data in parallel
            const [
                trainingNeedsData,
                performanceData,
                effectivenessData,
                categoryData,
                departmentData,
                budgetData
            ] = await Promise.all([
                getTrainingNeedsVsCompletion(dateRange, department, category),
                getPerformanceImprovementData(dateRange, department),
                getTrainingEffectivenessData(dateRange, category),
                getCategoryDistributionData(dateRange, department),
                getDepartmentGapAnalysis(dateRange),
                getBudgetRecommendationsData()
            ]);
            
            // Calculate summary metrics
            const summary = calculateSummaryMetrics(
                trainingNeedsData,
                performanceData,
                effectivenessData,
                categoryData
            );
            
            // Get filter options
            const departments = await getUniqueDepartments();
            const categories = await getUniqueCategories();
            
            const analyticsData = {
                summary,
                needsVsCompletion: trainingNeedsData,
                performanceTrend: performanceData,
                effectiveness: effectivenessData,
                categoryDistribution: categoryData,
                departmentGaps: departmentData,
                budgetRecommendations: budgetData,
                departments,
                categories
            };
            
            console.log(`✅ Analytics data prepared for ${trainingNeedsData.length} categories`);
            
            res.json({
                success: true,
                data: analyticsData
            });
            
        } catch (error) {
            console.error('❌ Error loading training analytics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load training analytics',
                error: error.message
            });
        }
    },
    
    getTrainingEfficiency: async function (req, res) {
        try {
            console.log('📊 Loading training efficiency data...');
            
            const { timePeriod = 'thisYear' } = req.query;
            const dateRange = calculateDateRange(timePeriod);
            
            // Get efficiency data by department
            const { data: trainingRecords, error } = await supabase
                .from('training_records')
                .select(`
                    trainingRecordId,
                    cost,
                    status,
                    isApproved,
                    dateRequested,
                    useraccounts!inner (
                        staffaccounts!inner (
                            departments!inner (
                                departmentId,
                                deptName
                            )
                        )
                    )
                `)
                .eq('isApproved', true)
                .gte('dateRequested', dateRange.startDate.toISOString().split('T')[0])
                .lte('dateRequested', dateRange.endDate.toISOString().split('T')[0]);

            if (error) throw error;

            // Calculate efficiency by department
            const deptEfficiency = {};
            
            trainingRecords.forEach(record => {
                const deptId = record.useraccounts?.staffaccounts?.[0]?.departments?.departmentId;
                const deptName = record.useraccounts?.staffaccounts?.[0]?.departments?.deptName;
                const cost = record.cost || 0;
                
                if (!deptEfficiency[deptId]) {
                    deptEfficiency[deptId] = {
                        departmentId: deptId,
                        departmentName: deptName,
                        totalCost: 0,
                        totalTrainings: 0,
                        completedTrainings: 0,
                        avgCostPerTraining: 0,
                        efficiencyScore: 0
                    };
                }
                
                deptEfficiency[deptId].totalCost += cost;
                deptEfficiency[deptId].totalTrainings++;
                
                if (record.status === 'Completed') {
                    deptEfficiency[deptId].completedTrainings++;
                }
            });

            // Calculate efficiency scores
            const efficiencyData = Object.values(deptEfficiency).map(dept => {
                dept.avgCostPerTraining = dept.totalTrainings > 0 ? 
                    Math.round(dept.totalCost / dept.totalTrainings) : 0;
                
                const completionRate = dept.totalTrainings > 0 ? 
                    (dept.completedTrainings / dept.totalTrainings) * 100 : 0;
                
                // Efficiency score: Higher completion rate + Lower cost = Higher efficiency
                dept.efficiencyScore = dept.avgCostPerTraining > 0 ? 
                    parseFloat((completionRate / (dept.avgCostPerTraining / 1000)).toFixed(1)) : 0;
                
                return dept;
            });

            // Calculate summary stats
            const bestEfficiency = Math.max(...efficiencyData.map(d => d.efficiencyScore));
            const avgEfficiency = efficiencyData.length > 0 ? 
                parseFloat((efficiencyData.reduce((sum, d) => sum + d.efficiencyScore, 0) / efficiencyData.length).toFixed(1)) : 0;
            const lowestEfficiency = Math.min(...efficiencyData.map(d => d.efficiencyScore));
            const avgCostPerTraining = efficiencyData.length > 0 ?
                Math.round(efficiencyData.reduce((sum, d) => sum + d.avgCostPerTraining, 0) / efficiencyData.length) : 0;

            const bestDept = efficiencyData.find(d => d.efficiencyScore === bestEfficiency)?.departmentName || '-';
            const lowestDept = efficiencyData.find(d => d.efficiencyScore === lowestEfficiency)?.departmentName || '-';

            res.json({
                success: true,
                data: {
                    summary: {
                        bestEfficiencyScore: bestEfficiency,
                        avgEfficiencyScore: avgEfficiency,
                        lowestEfficiencyScore: lowestEfficiency,
                        avgCostPerTraining,
                        bestEfficiencyDept: bestDept,
                        lowestEfficiencyDept: lowestDept
                    },
                    departmentEfficiency: efficiencyData.sort((a, b) => b.efficiencyScore - a.efficiencyScore)
                }
            });
            
        } catch (error) {
            console.error('❌ Error loading efficiency data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load efficiency data',
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
        
        // 🔥 FIX: Check if user exists first
        const { data: userCheck, error: userCheckError } = await supabase
            .from('applicantaccounts')
            .select('userId')
            .eq('userId', userId)
            .single();
            
        if (userCheckError || !userCheck) {
            console.error('❌ [Reupload Request] User not found:', userCheckError);
            return res.json({ success: false, message: `User not found: ${userId}` });
        }
        
        console.log('✅ [Reupload Request] User found:', userCheck.userId);
        
        // 🔥 FIX: Ensure document types are standardized
        const normalizedDocuments = documentsToReupload.map(doc => {
            switch(doc.toLowerCase()) {
                case 'degree':
                case 'degree_certificate':
                case 'degree certificate':
                    return 'degree';
                case 'certification':
                case 'cert':
                case 'certificate':
                    return 'certification';
                case 'resume':
                case 'cv':
                    return 'resume';
                case 'additional':
                case 'additional_document':
                case 'additional document':
                case 'addtl':
                    return 'additional';
                default:
                    return doc.toLowerCase();
            }
        });
        
        console.log('📂 [Reupload Request] Normalized documents:', normalizedDocuments);
        
        // Store the document types AND remarks
        const reuploadData = {
            documentsRequested: normalizedDocuments, // Use normalized document types
            remarks: remarks,
            requestedAt: new Date().toISOString()
        };
        
        console.log('📂 [Reupload Request] Reupload data to save:', JSON.stringify(reuploadData, null, 2));
        
        // 🔥 FIX: Check if assessment record exists first
        const { data: existingAssessment, error: checkError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('userId')
            .eq('userId', userId)
            .single();
        
        if (checkError && checkError.code === 'PGRST116') {
            // No record exists, create one
            console.log('📂 [Reupload Request] No assessment record found, creating one...');
            
            const { error: insertError } = await supabase
                .from('applicant_initialscreening_assessment')
                .insert({
                    userId: userId,
                    hrVerification: JSON.stringify(reuploadData),
                    isHRChosen: null
                });
            
            if (insertError) {
                console.error('❌ [Reupload Request] Error creating assessment record:', insertError);
                throw insertError;
            }
            
            console.log('✅ [Reupload Request] Assessment record created successfully');
        } else if (checkError) {
            console.error('❌ [Reupload Request] Error checking assessment record:', checkError);
            throw checkError;
        } else {
            // Record exists, update it
            console.log('📂 [Reupload Request] Assessment record exists, updating...');
            
            const { error: assessmentError } = await supabase
                .from('applicant_initialscreening_assessment')
                .update({ 
                    hrVerification: JSON.stringify(reuploadData),
                    isHRChosen: null
                })
                .eq('userId', userId);
            
            if (assessmentError) {
                console.error('❌ [Reupload Request] Error updating assessment record:', assessmentError);
                throw assessmentError;
            }
            
            console.log('✅ [Reupload Request] Assessment record updated successfully');
        }
        
        // Update applicant status to indicate reupload is requested
        const { error: statusError } = await supabase
            .from('applicantaccounts')
            .update({ 
                applicantStatus: "P1 - Awaiting for HR Action; Requested for Reupload" 
            })
            .eq('userId', userId);
        
        if (statusError) {
            console.error('❌ [Reupload Request] Error updating applicant status:', statusError);
            throw statusError;
        }
        
        console.log('✅ [Reupload Request] Applicant status updated successfully');
        
        // Create display names for documents
        const documentNames = normalizedDocuments.map(doc => {
            switch(doc) {
                case 'degree': return 'Degree Certificate';
                case 'certification': return 'Certification Document';
                case 'resume': return 'Resume';
                case 'additional': return 'Additional Document';
                default: return doc;
            }
        });
        
        const chatbotMessage = {
            text: `Hello! We have reviewed your application and would like to request some document updates. Please re-upload the following documents: ${documentNames.join(', ')}. 
            
HR Instructions: ${remarks}
            
Please upload each requested document using the buttons below. You need to upload ${normalizedDocuments.length} document(s).`,
            buttons: normalizedDocuments.map((docType, index) => ({
                text: `Upload ${documentNames[index]}`,
                type: 'file_upload_reupload',
                docType: docType // Use normalized document type
            })),
            reuploadData: reuploadData,
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
        
        if (chatError) {
            console.error('❌ [Reupload Request] Error saving chatbot message:', chatError);
            throw chatError;
        }
        
        console.log('✅ [Reupload Request] Chatbot message with normalized document types saved successfully');
        
        // 🔥 FINAL VERIFICATION: Check what was actually saved
        const { data: verifyData, error: verifyError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select('hrVerification')
            .eq('userId', userId)
            .single();
            
        if (verifyError) {
            console.error('❌ [Reupload Request] Error verifying saved data:', verifyError);
        } else {
            console.log('✅ [Reupload Request] Verification - Saved hrVerification:', verifyData.hrVerification);
        }
        
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
    console.log('🔧 [DEBUG] getOnboardingStartDate called');
    console.log('🔧 [DEBUG] req.query:', req.query);
    console.log('🔧 [DEBUG] Session user:', req.session.user);
    
    if (req.session.user && req.session.user.userRole === 'HR') {
        try {
            const { userId } = req.query;
            
            console.log('🔧 [DEBUG] Extracted params:', { userId });

            if (!userId) {
                console.error('❌ [DEBUG] userId is missing');
                return res.status(400).json({ 
                    success: false, 
                    message: 'Missing required parameter: userId' 
                });
            }

            console.log('🔧 [DEBUG] Querying onboarding_position-startdate with userId:', userId);

            // FIXED: Query by userId instead of jobId
            const { data, error } = await supabase
                .from('onboarding_position-startdate')
                .select('setStartDate, additionalNotes, isAccepted, jobId')
                .eq('userId', userId)
                .limit(1);

            if (error) {
                console.error('❌ [DEBUG] Error fetching start date from Supabase:', error);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Database error: ' + error.message 
                });
            }

            console.log('🔧 [DEBUG] Supabase query result:', data);

            // Check if we got any data
            if (!data || data.length === 0) {
                console.log('ℹ️ [DEBUG] No start date found for userId:', userId);
                return res.json({ 
                    success: false, 
                    message: 'No start date found for this user',
                    userId: userId
                });
            }

            // Get the first record
            const startDateRecord = data[0];
            
            // Check if setStartDate exists and is not null
            if (!startDateRecord.setStartDate) {
                console.log('ℹ️ [DEBUG] Start date is null for userId:', userId);
                return res.json({ 
                    success: false, 
                    message: 'Start date not set for this user',
                    userId: userId
                });
            }

            console.log('✅ [DEBUG] Returning successful response with start date:', startDateRecord.setStartDate);
            return res.json({ 
                success: true, 
                startDate: startDateRecord.setStartDate,
                additionalNotes: startDateRecord.additionalNotes || '',
                isAccepted: startDateRecord.isAccepted || false,
                userId: userId,
                jobId: startDateRecord.jobId
            });

        } catch (error) {
            console.error('❌ [DEBUG] Unexpected error in getOnboardingStartDate:', error);
            console.error('❌ [DEBUG] Error stack:', error.stack);
            return res.status(500).json({ 
                success: false, 
                message: 'Internal server error: ' + error.message 
            });
        }
    } else {
        console.error('❌ [DEBUG] Unauthorized access attempt');
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized access. HR role required.' 
        });
    }
},

sendOnboardingChecklist: async function(req, res) {
    console.log('🔧 [DEBUG] sendOnboardingChecklist called');
    console.log('🔧 [DEBUG] req.body:', req.body);
    
    if (req.session.user && req.session.user.userRole === 'HR') {
        try {
            const { userId, applicantId, jobId, startDate } = req.body;
            
            if (!userId || !applicantId || !jobId || !startDate) {
                console.error('❌ [DEBUG] Missing required information:', { userId, applicantId, jobId, startDate });
                return res.status(400).json({ success: false, message: 'Missing required information' });
            }
            
            console.log('🔧 [DEBUG] Upserting start date with userId:', userId);
            
            // FIXED: Save the start date using userId as the key
            const { error: startDateError } = await supabase
                .from('onboarding_position-startdate')
                .upsert({ 
                    userId: userId,        // Use userId instead of jobId as primary key
                    jobId: jobId,         // Keep jobId for reference
                    setStartDate: startDate,
                    updatedAt: new Date().toISOString()
                });
            
            if (startDateError) {
                console.error('❌ [DEBUG] Error saving start date:', startDateError);
                return res.status(500).json({ success: false, message: 'Failed to save start date: ' + startDateError.message });
            }
            
            console.log('✅ [DEBUG] Start date saved successfully');
            
            // Update the applicant status in the database
            console.log('🔧 [DEBUG] Updating applicant status for applicantId:', applicantId);
            const { error: updateError } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'Onboarding - First Day Checklist Sent' })
                .eq('applicantId', applicantId);
            
            if (updateError) {
                console.error('❌ [DEBUG] Error updating applicant status:', updateError);
                return res.status(500).json({ success: false, message: 'Failed to update applicant status: ' + updateError.message });
            }
            
            console.log('✅ [DEBUG] Applicant status updated successfully');
            
            // Get job title for the message
            const { data: jobData, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobTitle')
                .eq('jobId', jobId)
                .single();
                
            if (jobError) {
                console.error('❌ [DEBUG] Error fetching job title:', jobError);
            }
            
            const jobTitle = jobData ? jobData.jobTitle : 'the position';
            
            // Send a congratulatory message through the chatbot
            try {
                const currentTime = new Date().toISOString();
                
                console.log('🔧 [DEBUG] Sending chatbot message to userId:', userId);
                
                // Send a predefined message to the user's chatbot
                await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId: userId,
                        message: JSON.stringify({
                            text: "Congratulations! We're thrilled to inform you that you have successfully passed all phases of our screening processes. Please press the button below if you would like to accept the job offer for " + jobTitle + ".",
                            buttons: [
                                {
                                    text: "View Job Offer",
                                    url: "/applicant/job-offer"
                                }
                            ]
                        }),
                        sender: 'bot',
                        timestamp: currentTime,
                        applicantStage: 'Onboarding - First Day Checklist Sent'
                    }]);
                
                console.log('✅ [DEBUG] Job offer message sent to applicant through chatbot');
                
            } catch (chatError) {
                console.error('❌ [DEBUG] Error sending chatbot message:', chatError);
                // Continue execution - the status was updated successfully even if the message fails
            }
            
            // Return success response
            console.log('✅ [DEBUG] Onboarding process completed successfully');
            return res.json({
                success: true,
                message: 'Applicant status updated and job offer sent with start date: ' + startDate
            });
            
        } catch (error) {
            console.error('❌ [DEBUG] Unexpected error in sendOnboardingChecklist:', error);
            console.error('❌ [DEBUG] Error stack:', error.stack);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    } else {
        console.error('❌ [DEBUG] Unauthorized access attempt');
        return res.status(401).json({ success: false, message: 'Unauthorized access. HR role required.' });
    }
},
getApplicantOnboardingData: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'HR') {
        try {
            const { userId } = req.params;
            
            if (!userId) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'User ID is required' 
                });
            }
            
            console.log('HR DEBUG - Getting onboarding data for userId:', userId);
            
            // Get applicant data
            const { data: applicantData, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    firstName,
                    lastName,
                    phoneNo,
                    birthDate,
                    jobId,
                    useraccounts!inner(userEmail, birthDate)
                `)
                .eq('userId', userId)
                .single();
                
            if (applicantError || !applicantData) {
                console.error('Error fetching applicant data:', applicantError);
                return res.status(404).json({ 
                    success: false, 
                    message: 'Applicant not found for userId: ' + userId 
                });
            }
            
            // Get job title
            const { data: jobData, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobTitle')
                .eq('jobId', applicantData.jobId)
                .single();
            
            const responseData = {
                success: true,
                applicant: {
                    userId: userId,
                    applicantId: applicantData.applicantId,
                    firstName: applicantData.firstName,
                    lastName: applicantData.lastName,
                    email: applicantData.useraccounts?.userEmail || 'N/A',
                    phoneNo: applicantData.phoneNo || 'N/A',
                    birthDate: applicantData.useraccounts?.birthDate || applicantData.birthDate || 'N/A',
                    jobId: applicantData.jobId,
                    jobTitle: jobData?.jobTitle || 'N/A'
                }
            };
            
            console.log('Returning applicant data:', responseData);
            return res.json(responseData);
            
        } catch (error) {
            console.error('Error getting applicant onboarding data:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Internal server error: ' + error.message 
            });
        }
    } else {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized access. HR role required.' 
        });
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
                return res.redirect('/hr/dashboard');
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
    
            res.render('staffpages/hr_pages/useracc', { 
                user: userData,
                offboardingRequests: offboardingRequests || [] // Pass empty array if null
            });
        } catch (err) {
            console.error('Error in getUserAccount controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the account page.' });
            res.redirect('/hr/dashboard');
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

        // Update `applicantaccounts` using `userId` - CHANGED to match enum
        const { error: statusError } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: "P1 - FAILED" })
            .eq('userId', userId);
        
        if (statusError) throw statusError;

        res.json({ success: true, message: "Applicant status updated to P1 - FAILED successfully.", userId });
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
            } else if (passwordOption === 'random') {
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

            // Fetch department and job title names for the email
            const { data: department, error: deptError } = await supabase
                .from('departments')
                .select('deptName')
                .eq('departmentId', departmentId)
                .single();

            const { data: jobPosition, error: jobError } = await supabase
                .from('jobpositions')
                .select('jobTitle')
                .eq('jobId', jobId)
                .single();

            if (deptError || jobError) {
                console.error('Error fetching department/job data:', deptError || jobError);
                // Continue with staff creation even if we can't fetch names
            }

            // Prepare email data
            const emailData = {
                email: email,
                firstName: firstName,
                lastName: lastName,
                userRole: role,
                department: department ? department.deptName : 'Unknown Department',
                jobTitle: jobPosition ? jobPosition.jobTitle : 'Unknown Job Title',
                password: password
            };

            // Send welcome email
            console.log('Sending welcome email to:', email);
            const emailResult = await sendWelcomeEmail(emailData);
            
            if (emailResult.success) {
                console.log('Welcome email sent successfully');
                res.status(200).json({ 
                    message: 'Staff added successfully and welcome email sent.',
                    emailSent: true 
                });
            } else {
                console.error('Failed to send welcome email:', emailResult.error);
                res.status(200).json({ 
                    message: 'Staff added successfully, but failed to send welcome email.',
                    emailSent: false,
                    emailError: emailResult.error
                });
            }

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
    // 🔥 NEW: Add the congratulations message for P2 PASSED
    const congratsMessage = "Congratulations! We are pleased to inform you that you have successfully passed the initial interview. We would like to invite you for a final interview with our senior management team.";
    
    const { data: congratsChatData, error: congratsChatError } = await supabase
        .from('chatbot_history')
        .insert([{
            userId: applicantData.userId,
            message: JSON.stringify({ text: congratsMessage }),
            sender: 'bot',
            timestamp: new Date().toISOString(),
            applicantStage: 'P2 - PASSED'
        }]);
        
    if (congratsChatError) {
        console.error(`❌ [HR] Error adding congratulations message for ${applicantId}:`, congratsChatError);
    } else {
        console.log(`💬 [HR] Added congratulations message for passed applicant ${applicantId}`);
    }
    
    // 🔥 NEW: Add the Calendly link message for final interview
    const calendlyMessage = "Please click the button below to schedule your final interview at your convenience:";
    
    const { data: calendlyChatData, error: calendlyChatError } = await supabase
        .from('chatbot_history')
        .insert([{
            userId: applicantData.userId,
            message: JSON.stringify({ 
                text: calendlyMessage,
                buttons: [
                    { 
                        text: "Schedule Final Interview", 
                        value: "schedule_final_interview",
                        url: "/applicant/schedule-interview?stage=P2"
                    }
                ]
            }),
            sender: 'bot',
            timestamp: new Date(Date.now() + 1000).toISOString(), // 1 second delay
            applicantStage: 'P2 - PASSED'
        }]);
        
    if (calendlyChatError) {
        console.error(`❌ [HR] Error adding Calendly message for ${applicantId}:`, calendlyChatError);
    } else {
        console.log(`💬 [HR] Added Calendly message for passed applicant ${applicantId}`);
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
                                text: "We regret to inform you that you have not been selected to proceed to the next stage of the recruitment process. Thank you for your interest in Company ABC, and we wish you the best in your future endeavors." 
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


getP2EmailTemplates: async function(req, res) {
        try {
            console.log('📧 [HR] Fetching P2 email templates from emailService.js...');
            
            // Import your email templates
            const { emailTemplates } = require('../utils/emailService');
            
            // Extract P2 templates and convert to frontend format
            const p2Templates = {
                passed: {
                    subject: emailTemplates['P2 - PASSED']?.subject || 'Great News! You\'ve Advanced to Final Interview - Prime Infrastructure',
                    template: `Dear {applicantName},

🎯 Great News!

Congratulations! We are excited to inform you that you have successfully passed the HR interview stage for the {jobTitle} position at {companyName}.

Your performance during the HR interview was impressive, and our team was particularly pleased with your responses, qualifications, and the enthusiasm you demonstrated for joining our organization.

🎯 Final Interview Details:
• Next Stage: Final interview with the Line Manager and senior team members
• Focus Areas: Technical competencies, role-specific scenarios, and team fit assessment
• Duration: Approximately 45-60 minutes
• Format: In-person or virtual (details will be provided separately)

📋 What to Expect:
• Discussion about your technical skills and experience relevant to the role
• Scenario-based questions related to the position
• Opportunity to meet your potential direct supervisor
• Q&A session about the role, team, and company culture
• Discussion about career growth opportunities

⏰ Next Steps:
• Our scheduling team will contact you within 2-3 business days to arrange your final interview
• Please keep your calendar flexible for the upcoming week
• Check your applicant portal regularly for updates
• Prepare questions about the role and our team dynamics

💡 Interview Preparation Tips:
• Review the job description and prepare specific examples from your experience
• Research our recent projects and company developments
• Think about how your skills align with our team's current goals
• Prepare thoughtful questions about the role and team structure

We're excited about the possibility of you joining our team and look forward to the final stage of our interview process.

Best of luck with your preparation!

Best regards,
The {companyName} HR Team

P.S. If you have any questions or concerns before your final interview, please don't hesitate to reach out to our HR team.`
                },
                failed: {
                    subject: emailTemplates['P2 - FAILED']?.subject || 'Thank You for Your Interview - Prime Infrastructure',
                    template: `Dear {applicantName},

Thank you for taking the time to interview with us for the {jobTitle} position at {companyName}. We genuinely enjoyed learning more about your background, experience, and career aspirations during our HR interview process.

After careful consideration and thorough discussion among our interview panel, we have decided to move forward with another candidate whose background and experience more closely align with our current requirements for this specific role.

We want you to know that this was a difficult decision for our team. We were impressed with your qualifications, professionalism, and enthusiasm throughout the entire interview process, and you demonstrated many of the qualities we value highly at {companyName}.

🙏 Our Sincere Appreciation:
• Thank you for your time and effort in preparing for and participating in our comprehensive interview process
• We value the opportunity to have met you and learned about your professional experience and goals
• Your professionalism and enthusiasm were evident throughout all our interactions
• We appreciate your interest in {companyName} and the energy you brought to the interview

🚀 Moving Forward:
• Your application and interview details will remain in our talent database for future opportunities
• We may contact you if a suitable position becomes available that better matches your background and experience
• Please feel free to apply for other positions with us that align with your skills and career interests
• Follow our careers page and LinkedIn for new openings that might be a good fit for your profile

🌟 Stay Connected:
We encourage you to connect with us on LinkedIn and follow our company updates. The talent and experience you bring to the table are valuable, and we believe you'll find an excellent opportunity that's the right fit for your career goals.

We recognize that job searching can be challenging, and we wish you continued success in your career endeavors. We hope our paths may cross again in the future, and we encourage you to stay connected with {companyName}.

Thank you again for your interest in joining our team.

Best regards,
The {companyName} HR Team`
                }
            };
            
            res.json({
                success: true,
                templates: p2Templates
            });
            
            console.log('✅ [HR] P2 email templates sent successfully');
            
        } catch (error) {
            console.error('❌ [HR] Error fetching P2 email templates:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch P2 email templates: ' + error.message
            });
        }
    },
sendAutomatedEmail: async function(req, res) {
    try {
        const { email, subject, template, applicantName, jobTitle, phase, type } = req.body;
        
        console.log(`📧 [HR] Sending automated ${phase} ${type} email to: ${email}`);
        
        if (!email || !subject || !template || !applicantName || !jobTitle) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing required email parameters" 
            });
        }
        
        // Process the template with actual values
        const processedTemplate = template
            .replace(/\{applicantName\}/g, applicantName)
            .replace(/\{jobTitle\}/g, jobTitle)
            .replace(/\{companyName\}/g, 'Prime Infrastructure');
        
        // Try to require the email service
        let sendEmail;
        try {
            const emailService = require('../utils/emailService');
            sendEmail = emailService.sendEmail;
            
            if (typeof sendEmail !== 'function') {
                throw new Error('sendEmail is not a function in emailService');
            }
        } catch (requireError) {
            console.error('❌ [HR] Error requiring emailService:', requireError);
            return res.status(500).json({
                success: false,
                message: 'Email service not available: ' + requireError.message
            });
        }
        
        const result = await sendEmail(email, subject, processedTemplate);
        
        if (result && result.success) {
            console.log(`✅ [HR] P2 Email sent successfully to ${email}`);
            res.json({
                success: true,
                messageId: result.messageId,
                message: 'Email sent successfully'
            });
        } else {
            console.error(`❌ [HR] Failed to send P2 email to ${email}`);
            res.json({
                success: false,
                message: result?.error || 'Failed to send email'
            });
        }
        
    } catch (error) {
        console.error('❌ [HR] Error in P2 send-automated-email:', error);
        res.status(500).json({
            success: false,
            message: 'Server error: ' + error.message
        });
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
            
            console.log('🔍 [HR Applicants Report] Fetching applicants data with intelligence...');
            
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
                    created_at,
                    userId,
                    jobId,
                    departmentId,
                    useraccounts!inner(userEmail),
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `)
                .order('created_at', { ascending: false });

            // Apply date filters
            if (startDate) {
                query = query.gte('created_at', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDateTime.toISOString());
            }

            const { data: applicants, error } = await query;

            if (error) {
                console.error('❌ [HR Applicants Report] Error fetching applicants:', error);
                return res.status(500).json({ success: false, message: 'Error fetching applicants data: ' + error.message });
            }

            // Fetch scores from assessment tables
            const userIds = applicants.map(a => a.userId);

            const [initialScores, hrScores, panelScores] = await Promise.all([
                supabase.from('applicant_initialscreening_assessment')
                    .select('userId, totalScore')
                    .in('userId', userIds),
                supabase.from('applicant_hrscreening_assessment')
                    .select('applicantUserid, totalAssessmentRating')
                    .in('applicantUserid', userIds),
                supabase.from('applicant_panelscreening_assessment')
                    .select('applicantUserId, totalAssessmentRating')
                    .in('applicantUserId', userIds)
            ]);

            // Create score lookup maps
            const initialScoreMap = new Map();
            const hrScoreMap = new Map();
            const panelScoreMap = new Map();

            if (initialScores.data) {
                initialScores.data.forEach(score => {
                    initialScoreMap.set(score.userId, score.totalScore);
                });
            }

            if (hrScores.data) {
                hrScores.data.forEach(score => {
                    hrScoreMap.set(score.applicantUserid, score.totalAssessmentRating);
                });
            }

            if (panelScores.data) {
                panelScores.data.forEach(score => {
                    panelScoreMap.set(score.applicantUserId, score.totalAssessmentRating);
                });
            }

            console.log(`✅ [HR Applicants Report] Found ${applicants.length} applicants`);

            // === NEW: BUSINESS INTELLIGENCE ANALYSIS ===

            // 1. Performance Analysis (NEW)
            const performanceAnalysis = {
                highPerformers: applicants.filter(a => {
                    const total = (a.initialScreeningScore || 0) + (a.hrInterviewFormScore || 0) + (a.lineManagerFormEvalScore || 0);
                    return total >= 240; // 80% of 300 max score
                }),
                averagePerformers: applicants.filter(a => {
                    const total = (a.initialScreeningScore || 0) + (a.hrInterviewFormScore || 0) + (a.lineManagerFormEvalScore || 0);
                    return total >= 180 && total < 240; // 60-79%
                }),
                lowPerformers: applicants.filter(a => {
                    const total = (a.initialScreeningScore || 0) + (a.hrInterviewFormScore || 0) + (a.lineManagerFormEvalScore || 0);
                    return total > 0 && total < 180; // Below 60%
                })
            };

            // 2. Pipeline Efficiency Analysis (NEW)
            const pipelineAnalysis = {
                pendingHRAction: applicants.filter(a => {
                    const status = (a.applicantStatus || '').toLowerCase();
                    return status.includes('pending hr') || 
                        status.includes('awaiting hr') ||
                        status.includes('hr interview') ||
                        status.includes('p1');
                }),
                pendingLineManagerAction: applicants.filter(a => {
                    const status = (a.applicantStatus || '').toLowerCase();
                    return status.includes('awaiting line manager') || 
                        status.includes('pending line manager') ||
                        status.includes('p2') ||
                        status.includes('panel interview');
                }),
                stuckInScreening: applicants.filter(a => {
                    const status = (a.applicantStatus || '').toLowerCase();
                    const daysSinceApplication = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                    return status.includes('screening') && daysSinceApplication > 10;
                }),
                fastTrack: applicants.filter(a => {
                    const daysSinceApplication = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                    const status = (a.applicantStatus || '').toLowerCase();
                    return daysSinceApplication <= 7 && (status.includes('hired') || status.includes('final'));
                })
            };

            // 3. Enhanced Department Analysis (REPLACES your existing departmentAnalysis)
            const departmentAnalysis = {};
            applicants.forEach(applicant => {
                const deptName = applicant.departments?.deptName || 'Unknown';
                if (!departmentAnalysis[deptName]) {
                    departmentAnalysis[deptName] = {
                        department: deptName,
                        totalApplicants: 0,
                        hired: 0,
                        pending: 0,
                        rejected: 0,
                        avgProcessingTime: 0,
                        avgScore: 0,
                        scores: []
                    };
                }
                
                const dept = departmentAnalysis[deptName];
                dept.totalApplicants++;
                
                const status = (applicant.applicantStatus || '').toLowerCase();
                if (status.includes('hired') || status.includes('onboarding')) {
                    dept.hired++;
                } else if (status.includes('rejected') || status.includes('failed')) {
                    dept.rejected++;
                } else {
                    dept.pending++;
                }
                
                // Calculate processing time
                const days = Math.floor((new Date() - new Date(applicant.created_at)) / (1000 * 60 * 60 * 24));
                dept.avgProcessingTime += days;
                
                // Calculate scores
                const totalScore = (applicant.initialScreeningScore || 0) + (applicant.hrInterviewFormScore || 0) + (applicant.lineManagerFormEvalScore || 0);
                if (totalScore > 0) dept.scores.push(totalScore);
            });

            // Process department averages (NEW)
            Object.values(departmentAnalysis).forEach(dept => {
                dept.avgProcessingTime = dept.totalApplicants > 0 ? Math.round(dept.avgProcessingTime / dept.totalApplicants) : 0;
                dept.avgScore = dept.scores.length > 0 ? Math.round(dept.scores.reduce((sum, score) => sum + score, 0) / dept.scores.length) : 0;
                dept.successRate = dept.totalApplicants > 0 ? Math.round((dept.hired / dept.totalApplicants) * 100) : 0;
                dept.conversionRate = dept.totalApplicants > 0 ? Math.round((dept.hired / dept.totalApplicants) * 100) : 0;
            });

            const departmentComparison = Object.values(departmentAnalysis).sort((a, b) => b.successRate - a.successRate);

            // === NEW: INTELLIGENT INSIGHTS GENERATION ===
            const insights = [];
            const actionItems = [];
            const recommendations = [];

            // Performance Insights (NEW)
            if (performanceAnalysis.highPerformers.length > 0) {
                insights.push(`🌟 ${performanceAnalysis.highPerformers.length} high-performing candidates identified (scores ≥80%) - prioritize these for fast-tracking`);
                actionItems.push(`Schedule immediate interviews for ${performanceAnalysis.highPerformers.length} top-tier candidates`);
            }

            if (performanceAnalysis.lowPerformers.length > performanceAnalysis.highPerformers.length && performanceAnalysis.lowPerformers.length > 5) {
                insights.push(`⚠️ High ratio of low-performing candidates suggests need to review screening criteria across departments`);
                recommendations.push('Implement enhanced pre-screening questionnaires to improve candidate quality');
            }

            // Pipeline Insights (NEW)
            if (pipelineAnalysis.pendingHRAction.length > 0) {
                insights.push(`⏰ ${pipelineAnalysis.pendingHRAction.length} candidates pending HR action - review interview scheduling capacity`);
                actionItems.push(`Schedule HR interviews for ${pipelineAnalysis.pendingHRAction.length} candidates within 3 business days`);
            }

            if (pipelineAnalysis.pendingLineManagerAction.length > 0) {
                insights.push(`📋 ${pipelineAnalysis.pendingLineManagerAction.length} candidates awaiting line manager review - follow up with departments`);
                actionItems.push(`Send reminders to line managers for ${pipelineAnalysis.pendingLineManagerAction.length} pending reviews`);
            }

            // Department Performance Insights (NEW)
            if (departmentComparison.length > 1) {
                const bestDept = departmentComparison[0];
                const worstDept = departmentComparison[departmentComparison.length - 1];
                
                if (bestDept.successRate >= 70 && bestDept.totalApplicants >= 5) {
                    insights.push(`🏆 ${bestDept.department} department leads with ${bestDept.successRate}% success rate - analyze their best practices`);
                    recommendations.push(`Share ${bestDept.department}'s recruitment strategies with other departments`);
                }
                
                if (worstDept.successRate < 30 && worstDept.totalApplicants >= 5) {
                    insights.push(`📉 ${worstDept.department} department shows ${worstDept.successRate}% success rate - requires intervention`);
                    actionItems.push(`Schedule performance review meeting with ${worstDept.department} line manager`);
                    recommendations.push(`Provide recruitment training and support to ${worstDept.department}`);
                }
            }

            // KEEP your existing summary calculation but add intelligence metrics
            const summary = {
                totalApplications: applicants.length,
                pendingHRAction: pipelineAnalysis.pendingHRAction.length,
                pendingLineManagerAction: pipelineAnalysis.pendingLineManagerAction.length,
                hired: applicants.filter(a => (a.applicantStatus || '').toLowerCase().includes('hired')).length,
                rejected: applicants.filter(a => (a.applicantStatus || '').toLowerCase().includes('rejected')).length,
                // NEW: Intelligence metrics
                highPerformers: performanceAnalysis.highPerformers.length,
                urgentActions: actionItems.length
            };

            // KEEP your existing processedApplicants logic but add intelligence flags
            const processedApplicants = applicants.map(applicant => {
                const initialScore = initialScoreMap.get(applicant.userId) || 0;
                const hrScore = hrScoreMap.get(applicant.userId) || 0;
                const panelScore = panelScoreMap.get(applicant.userId) || 0;
                const totalScore = initialScore + hrScore + panelScore;
                const daysSinceApplication = Math.floor((new Date() - new Date(applicant.created_at)) / (1000 * 60 * 60 * 24));
                
                // NEW: Intelligence flags
                let flags = [];
                if (totalScore >= 240) flags.push('high-performer');
                if (daysSinceApplication > 30) flags.push('delayed');
                if ((applicant.applicantStatus || '').toLowerCase().includes('pending hr')) flags.push('pending-hr-action');
                if ((applicant.applicantStatus || '').toLowerCase().includes('pending line manager')) flags.push('pending-lm-action');
                if (totalScore > 0 && totalScore < 150) flags.push('low-score');

                return {
                    applicantId: applicant.applicantId,
                    lastName: applicant.lastName || 'N/A',
                    firstName: applicant.firstName || 'N/A',
                    middleInitial: applicant.middleInitial || '',
                    email: applicant.useraccounts?.userEmail || 'N/A',
                    phoneNumber: applicant.phoneNo || 'N/A',
                    jobTitle: applicant.jobpositions?.jobTitle || 'N/A',
                    department: applicant.departments?.deptName || 'N/A',
                    applicationDate: applicant.created_at ? 
                        new Date(applicant.created_at).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'N/A',
                    status: applicant.applicantStatus || 'Pending',
                    initialScreeningScore: initialScore || 'N/A',
                    hrInterviewScore: hrScore || 'N/A',
                    lineManagerScore: panelScore || 'N/A',
                    totalScore: totalScore > 0 ? totalScore : 'N/A',
                    daysInProcess: daysSinceApplication,
                    intelligenceFlags: flags // NEW
                };
            });

            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return res.json({
                success: true,
                data: processedApplicants,
                summary: summary,
                insights: insights, // NEW
                actionItems: actionItems, // NEW
                recommendations: recommendations, // NEW
                intelligence: { // NEW
                    performanceAnalysis,
                    pipelineAnalysis,
                    departmentComparison
                },
                generatedOn: generatedOn,
                reportTitle: 'Applicants Report (HR) - Intelligence Enhanced' // UPDATED
            });

        } catch (error) {
            console.error('❌ [HR Applicants Report] Error:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    // Add this endpoint to your HR controller
getApplicantAssessment: async function(req, res) {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }
        
        console.log(`📡 Fetching assessment data for userId: ${userId}`);
        
        const { data: assessment, error } = await supabase
            .from('applicant_initialscreening_assessment')
            .select(`
                userId,
                totalScore,
                workSetupScore,
                availabilityScore,
                degreeScore,
                experienceScore,
                certificationScore,
                hardSkillsScore,
                softSkillsScore
            `)
            .eq('userId', userId)
            .single();
        
        if (error) {
            console.error('Error fetching assessment:', error);
            return res.status(404).json({ 
                success: false, 
                message: 'Assessment not found' 
            });
        }
        
        console.log(`✅ Found assessment for userId ${userId}:`, assessment);
        
        res.json({ 
            success: true, 
            assessment: assessment 
        });
        
    } catch (error) {
        console.error('Error in getApplicantAssessment:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
},
    getHireesReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { startDate, endDate, format } = req.query;
            
            console.log('🔍 [HR Hirees Report] Fetching hirees data with business intelligence...');
            
            // Enhanced query to get ALL required data including scores
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

            // Apply date filters
            if (startDate) {
                query = query.gte('created_at', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDateTime.toISOString());
            }

            const { data: allApplicants, error } = await query;

            if (error) {
                console.error('❌ [HR Hirees Report] Error fetching applicants:', error);
                return res.status(500).json({ success: false, message: 'Error fetching applicants data: ' + error.message });
            }

            // Filter for hired applicants
            const hirees = allApplicants.filter(applicant => {
                const status = applicant.applicantStatus || '';
                return status.toLowerCase().includes('hired') || 
                    status.toLowerCase().includes('onboarding');
            });

            // Fetch scores from assessment tables for hirees only
            const hireedUserIds = hirees.map(h => h.userId);

            const [initialScores, hrScores, panelScores] = await Promise.all([
                supabase.from('applicant_initialscreening_assessment')
                    .select('userId, totalScore')
                    .in('userId', hireedUserIds),
                supabase.from('applicant_hrscreening_assessment')
                    .select('applicantUserid, totalAssessmentRating')
                    .in('applicantUserid', hireedUserIds),
                supabase.from('applicant_panelscreening_assessment')
                    .select('applicantUserId, totalAssessmentRating')
                    .in('applicantUserId', hireedUserIds)
            ]);

            // Create score lookup maps
            const initialScoreMap = new Map();
            const hrScoreMap = new Map();
            const panelScoreMap = new Map();

            if (initialScores.data) {
                initialScores.data.forEach(score => {
                    initialScoreMap.set(score.userId, score.totalScore);
                });
            }

            if (hrScores.data) {
                hrScores.data.forEach(score => {
                    hrScoreMap.set(score.applicantUserid, score.totalAssessmentRating);
                });
            }

            if (panelScores.data) {
                panelScores.data.forEach(score => {
                    panelScoreMap.set(score.applicantUserId, score.totalAssessmentRating);
                });
            }

            console.log(`✅ [HR Hirees Report] Found ${hirees.length} hirees for intelligence analysis`);

            // === BUSINESS INTELLIGENCE ANALYSIS ===

            // 1. Hiring Quality Analysis
            const qualityAnalysis = {
                excellentHires: hirees.filter(h => {
                    const initialScore = initialScoreMap.get(h.userId) || 0;
                    const hrScore = hrScoreMap.get(h.userId) || 0;
                    const panelScore = panelScoreMap.get(h.userId) || 0;
                    const total = initialScore + hrScore + panelScore;
                    return total >= 270; // 90%+ of 300 max score
                }),
                goodHires: hirees.filter(h => {
                    const initialScore = initialScoreMap.get(h.userId) || 0;
                    const hrScore = hrScoreMap.get(h.userId) || 0;
                    const panelScore = panelScoreMap.get(h.userId) || 0;
                    const total = initialScore + hrScore + panelScore;
                    return total >= 210 && total < 270; // 70-89%
                }),
                averageHires: hirees.filter(h => {
                    const initialScore = initialScoreMap.get(h.userId) || 0;
                    const hrScore = hrScoreMap.get(h.userId) || 0;
                    const panelScore = panelScoreMap.get(h.userId) || 0;
                    const total = initialScore + hrScore + panelScore;
                    return total >= 150 && total < 210; // 50-69%
                }),
                riskHires: hirees.filter(h => {
                    const initialScore = initialScoreMap.get(h.userId) || 0;
                    const hrScore = hrScoreMap.get(h.userId) || 0;
                    const panelScore = panelScoreMap.get(h.userId) || 0;
                    const total = initialScore + hrScore + panelScore;
                    return total > 0 && total < 150; // Below 50%
                })
            };

            // 2. Hiring Velocity Analysis
            const velocityAnalysis = {
                fastHires: hirees.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days <= 21; // Hired within 3 weeks
                }),
                standardHires: hirees.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days > 21 && days <= 45; // 3-6 weeks
                }),
                slowHires: hirees.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days > 45; // Over 6 weeks
                }),
                avgTimeToHire: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => {
                    return sum + Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                }, 0) / hirees.length) : 0
            };

            // 3. Department Performance Analysis
            const departmentAnalysis = {};
            hirees.forEach(hiree => {
                const deptName = hiree.departments?.deptName || 'Unknown';
                if (!departmentAnalysis[deptName]) {
                    departmentAnalysis[deptName] = {
                        department: deptName,
                        totalHires: 0,
                        fullTime: 0,
                        partTime: 0,
                        contract: 0,
                        avgTimeToHire: 0,
                        avgScore: 0,
                        scores: [],
                        daysToHire: []
                    };
                }
                
                const dept = departmentAnalysis[deptName];
                dept.totalHires++;
                
                // Job type breakdown
                const jobType = hiree.jobpositions?.jobType || '';
                if (jobType === 'Full-time') dept.fullTime++;
                else if (jobType === 'Part-time') dept.partTime++;
                else if (jobType === 'Contract') dept.contract++;
                
                // Calculate days to hire
                const days = Math.floor((new Date() - new Date(hiree.created_at)) / (1000 * 60 * 60 * 24));
                dept.daysToHire.push(days);
                
                // Calculate scores
                const initialScore = initialScoreMap.get(hiree.userId) || 0;
                const hrScore = hrScoreMap.get(hiree.userId) || 0;
                const panelScore = panelScoreMap.get(hiree.userId) || 0;
                const totalScore = initialScore + hrScore + panelScore;
                if (totalScore > 0) dept.scores.push(totalScore);
            });

            // Process department averages
            const departmentComparison = Object.values(departmentAnalysis).map(dept => {
                dept.avgTimeToHire = dept.daysToHire.length > 0 ? Math.round(dept.daysToHire.reduce((sum, days) => sum + days, 0) / dept.daysToHire.length) : 0;
                dept.avgScore = dept.scores.length > 0 ? Math.round(dept.scores.reduce((sum, score) => sum + score, 0) / dept.scores.length) : 0;
                dept.hiringEfficiency = dept.avgTimeToHire <= 30 ? 'Excellent' : dept.avgTimeToHire <= 45 ? 'Good' : 'Needs Improvement';
                return dept;
            }).sort((a, b) => b.totalHires - a.totalHires);

            // 4. Job Type Distribution Analysis
            const jobTypeAnalysis = {
                fullTime: hirees.filter(h => h.jobpositions?.jobType === 'Full-time'),
                partTime: hirees.filter(h => h.jobpositions?.jobType === 'Part-time'),
                contract: hirees.filter(h => h.jobpositions?.jobType === 'Contract'),
                internship: hirees.filter(h => h.jobpositions?.jobType === 'Internship'),
                temporary: hirees.filter(h => h.jobpositions?.jobType === 'Temporary')
            };

            // 5. Onboarding Status Analysis
            const onboardingAnalysis = {
                onboarding: hirees.filter(h => {
                    const status = h.applicantStatus || '';
                    return status.toLowerCase().includes('onboarding');
                }),
                completed: hirees.filter(h => {
                    const status = h.applicantStatus || '';
                    return status.toLowerCase().includes('hired') && !status.toLowerCase().includes('onboarding');
                }),
                recentHires: hirees.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days <= 30; // Hired within last 30 days
                })
            };

            // 6. Seasonal Trends Analysis
            const seasonalAnalysis = {};
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            
            // Initialize months
            monthNames.forEach(month => {
                seasonalAnalysis[month] = 0;
            });

            // Count hires by month
            hirees.forEach(h => {
                const hireDate = new Date(h.created_at);
                const monthName = monthNames[hireDate.getMonth()];
                seasonalAnalysis[monthName]++;
            });

            // Find peak hiring month
            const peakMonth = Object.keys(seasonalAnalysis).reduce((a, b) => 
                seasonalAnalysis[a] > seasonalAnalysis[b] ? a : b
            );

            // 7. Performance Score Analysis
            const scoreAnalysis = {
                avgInitialScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => sum + (initialScoreMap.get(h.userId) || 0), 0) / hirees.length) : 0,
                avgHRScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => sum + (hrScoreMap.get(h.userId) || 0), 0) / hirees.length) : 0,
                avgLineManagerScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => sum + (panelScoreMap.get(h.userId) || 0), 0) / hirees.length) : 0,
                avgTotalScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => {
                    const initialScore = initialScoreMap.get(h.userId) || 0;
                    const hrScore = hrScoreMap.get(h.userId) || 0;
                    const panelScore = panelScoreMap.get(h.userId) || 0;
                    return sum + (initialScore + hrScore + panelScore);
                }, 0) / hirees.length) : 0
            };

            // === INTELLIGENT INSIGHTS GENERATION ===
            const insights = [];
            const actionItems = [];
            const recommendations = [];
            const successMetrics = [];

            // Quality Insights
            if (qualityAnalysis.excellentHires.length > 0) {
                const percentage = Math.round((qualityAnalysis.excellentHires.length / hirees.length) * 100);
                insights.push(`🌟 ${qualityAnalysis.excellentHires.length} excellent hires (${percentage}%) with scores ≥90% - outstanding recruitment quality`);
                successMetrics.push(`${percentage}% excellent hire rate demonstrates strong candidate evaluation process`);
            }

            if (qualityAnalysis.riskHires.length > 0) {
                const percentage = Math.round((qualityAnalysis.riskHires.length / hirees.length) * 100);
                insights.push(`⚠️ ${qualityAnalysis.riskHires.length} risk hires (${percentage}%) with low scores - monitor performance closely`);
                actionItems.push(`Schedule 30-day check-ins for ${qualityAnalysis.riskHires.length} lower-scoring new hires`);
                recommendations.push('Consider raising minimum score thresholds for future hiring decisions');
            }

            // Velocity Insights
            if (velocityAnalysis.avgTimeToHire <= 21) {
                insights.push(`🚀 Excellent hiring velocity - average ${velocityAnalysis.avgTimeToHire} days to hire (target: <30 days)`);
                successMetrics.push(`Fast hiring process maintains competitive advantage in talent acquisition`);
            } else if (velocityAnalysis.avgTimeToHire > 45) {
                insights.push(`⏰ Slow hiring velocity - average ${velocityAnalysis.avgTimeToHire} days to hire exceeds best practices`);
                recommendations.push('Streamline interview scheduling and decision-making processes to reduce time-to-hire');
                actionItems.push('Review and optimize interview scheduling workflow');
            }

            // Department Insights
            if (departmentComparison.length > 1) {
                const bestDept = departmentComparison[0];
                const slowDept = departmentComparison.find(d => d.avgTimeToHire > 45);
                
                if (bestDept.totalHires >= 3) {
                    insights.push(`🏆 ${bestDept.department} leads in hiring volume with ${bestDept.totalHires} new hires`);
                }
                
                if (slowDept) {
                    insights.push(`📉 ${slowDept.department} shows slow hiring velocity (${slowDept.avgTimeToHire} days avg) - needs support`);
                    actionItems.push(`Provide recruitment process improvement support to ${slowDept.department}`);
                }
            }

            // Job Type Insights
            const totalHires = hirees.length;
            if (jobTypeAnalysis.fullTime.length / totalHires > 0.8) {
                insights.push(`💼 Strong focus on full-time hiring (${Math.round((jobTypeAnalysis.fullTime.length / totalHires) * 100)}%) indicates strategic workforce building`);
            }

            if (jobTypeAnalysis.contract.length > 0) {
                const contractPercentage = Math.round((jobTypeAnalysis.contract.length / totalHires) * 100);
                insights.push(`📝 ${contractPercentage}% contract hires provide workforce flexibility`);
            }

            // Onboarding Insights
            if (onboardingAnalysis.onboarding.length > 0) {
                insights.push(`🎯 ${onboardingAnalysis.onboarding.length} new hires currently in onboarding process`);
                actionItems.push(`Monitor onboarding progress for ${onboardingAnalysis.onboarding.length} new team members`);
            }

            if (onboardingAnalysis.recentHires.length > 0) {
                insights.push(`👥 ${onboardingAnalysis.recentHires.length} recent hires (last 30 days) - ensure proper integration and support`);
                actionItems.push(`Schedule integration check-ins for ${onboardingAnalysis.recentHires.length} recent hires`);
            }

            // Seasonal Insights
            if (seasonalAnalysis[peakMonth] > 0) {
                insights.push(`📅 Peak hiring month: ${peakMonth} with ${seasonalAnalysis[peakMonth]} hires - useful for future planning`);
                recommendations.push(`Plan increased recruitment activities around ${peakMonth} based on historical success`);
            }

            // Score Performance Insights
            if (scoreAnalysis.avgTotalScore >= 240) {
                insights.push(`📊 Excellent average hire score (${scoreAnalysis.avgTotalScore}/300) indicates strong candidate quality`);
                successMetrics.push('High-quality candidate selection process validates recruitment strategy');
            } else if (scoreAnalysis.avgTotalScore < 180) {
                insights.push(`📉 Below-average hire scores (${scoreAnalysis.avgTotalScore}/300) suggest need for improved screening`);
                recommendations.push('Review and enhance screening criteria to improve candidate quality');
            }

            // Enhanced summary statistics with intelligence
            const summary = {
                totalHirees: hirees.length,
                fullTime: jobTypeAnalysis.fullTime.length,
                partTime: jobTypeAnalysis.partTime.length,
                contract: jobTypeAnalysis.contract.length,
                onboarding: onboardingAnalysis.onboarding.length,
                // Intelligence metrics
                avgTimeToHire: velocityAnalysis.avgTimeToHire,
                avgHireScore: scoreAnalysis.avgTotalScore,
                excellentHires: qualityAnalysis.excellentHires.length,
                riskHires: qualityAnalysis.riskHires.length,
                fastHires: velocityAnalysis.fastHires.length,
                recentHires: onboardingAnalysis.recentHires.length,
                peakHiringMonth: peakMonth,
                successRate: Math.round((qualityAnalysis.excellentHires.length + qualityAnalysis.goodHires.length) / hirees.length * 100)
            };

            // Helper function to calculate hire quality score
            const calculateHireQuality = (hiree) => {
                const initialScore = initialScoreMap.get(hiree.userId) || 0;
                const hrScore = hrScoreMap.get(hiree.userId) || 0;
                const panelScore = panelScoreMap.get(hiree.userId) || 0;
                const total = initialScore + hrScore + panelScore;
                if (total >= 270) return 'Excellent';
                if (total >= 210) return 'Good';
                if (total >= 150) return 'Average';
                if (total > 0) return 'Risk';
                return 'No Score';
            };

            // Process hirees data with intelligence flags
            const processedHirees = hirees.map((hiree, index) => {
                const initialScore = initialScoreMap.get(hiree.userId) || 0;
                const hrScore = hrScoreMap.get(hiree.userId) || 0;
                const panelScore = panelScoreMap.get(hiree.userId) || 0;
                const totalScore = initialScore + hrScore + panelScore;
                const daysToHire = Math.floor((new Date() - new Date(hiree.created_at)) / (1000 * 60 * 60 * 24));
                const quality = calculateHireQuality(hiree);
                
                // Intelligence flags
                let flags = [];
                if (quality === 'Excellent') flags.push('top-performer');
                if (quality === 'Risk') flags.push('retention-risk');
                if (daysToHire <= 21) flags.push('fast-hire');
                if (daysToHire > 45) flags.push('slow-hire');
                if ((hiree.applicantStatus || '').toLowerCase().includes('onboarding')) flags.push('onboarding');
                if (daysToHire <= 30) flags.push('recent-hire');

                return {
                    hireId: `HIR${String(index + 1).padStart(3, '0')}`,
                    lastName: hiree.lastName || 'N/A',
                    firstName: hiree.firstName || 'N/A', 
                    middleInitial: hiree.middleInitial || '',
                    email: hiree.useraccounts?.userEmail || 'N/A',
                    phoneNumber: hiree.phoneNo || 'N/A',
                    jobTitle: hiree.jobpositions?.jobTitle || 'N/A',
                    department: hiree.departments?.deptName || 'N/A',
                    jobType: hiree.jobpositions?.jobType || 'Full-time',
                    hireDate: hiree.created_at ? 
                        new Date(hiree.created_at).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'N/A',
                    daysToHire: daysToHire,
                    totalScore: totalScore > 0 ? totalScore : 'N/A',
                    hireQuality: quality,
                    intelligenceFlags: flags,
                    retentionRisk: quality === 'Risk' || daysToHire > 60 ? 'High' : quality === 'Average' ? 'Medium' : 'Low'
                };
            });

            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return res.json({
                success: true,
                data: processedHirees,
                summary: summary,
                insights: insights,
                actionItems: actionItems,
                recommendations: recommendations,
                successMetrics: successMetrics,
                intelligence: {
                    qualityAnalysis,
                    velocityAnalysis,
                    departmentComparison,
                    jobTypeAnalysis,
                    onboardingAnalysis,
                    seasonalAnalysis,
                    scoreAnalysis
                },
                generatedOn: generatedOn,
                reportTitle: 'Hirees Report (HR) - Intelligence Enhanced'
            });

        } catch (error) {
            console.error('❌ [HR Hirees Report] Error:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    getApplicantStatusReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { applicantName, format } = req.query;
            
            console.log('🔍 [HR Status Report] Searching applicant by name with intelligence...');
            
            if (!applicantName || applicantName.trim().length < 2) {
                return res.status(400).json({ success: false, message: 'Applicant name is required (minimum 2 characters)' });
            }

            const searchName = applicantName.trim().toLowerCase();

            // Enhanced query to get ALL required data including scores
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
                console.error('❌ [HR Status Report] Error searching applicants:', searchError);
                return res.status(500).json({ success: false, message: 'Error searching applicants: ' + searchError.message });
            }

            // Filter by name in JavaScript
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

            if (matchingApplicants.length === 0) {
                return res.json({
                    success: false,
                    message: `No applicants found matching "${applicantName}". Please check the spelling and try again.`,
                    searchSuggestion: true
                });
            }

            if (matchingApplicants.length > 1) {
                const suggestions = matchingApplicants.map(applicant => ({
                    applicantId: applicant.applicantId,
                    name: `${applicant.firstName} ${applicant.lastName}`,
                    email: applicant.useraccounts?.userEmail || 'N/A',
                    position: applicant.jobpositions?.jobTitle || 'N/A',
                    department: applicant.departments?.deptName || 'N/A',
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

            // Exactly one match found
            const applicant = matchingApplicants[0];

            // Fetch scores from assessment tables for this specific applicant
            const [initialScore, hrScore, panelScore] = await Promise.all([
                supabase.from('applicant_initialscreening_assessment')
                    .select('totalScore')
                    .eq('userId', applicant.userId)
                    .single(),
                supabase.from('applicant_hrscreening_assessment')
                    .select('totalAssessmentRating')
                    .eq('applicantUserid', applicant.userId)
                    .single(),
                supabase.from('applicant_panelscreening_assessment')
                    .select('totalAssessmentRating')
                    .eq('applicantUserId', applicant.userId)
                    .single()
            ]);

            // Extract scores with fallbacks
            const applicantInitialScore = initialScore.data?.totalScore || 0;
            const applicantHRScore = hrScore.data?.totalAssessmentRating || 0;
            const applicantPanelScore = panelScore.data?.totalAssessmentRating || 0;

            // === INTELLIGENT STATUS ANALYSIS ===
            
            // Calculate processing metrics
            const applicationDate = new Date(applicant.created_at);
            const currentDate = new Date();
            const daysInProcess = Math.floor((currentDate - applicationDate) / (1000 * 60 * 60 * 24));
            const totalScore = applicantInitialScore + applicantHRScore + applicantPanelScore;

            // Status progression analysis
            const statusProgression = {
                hrScreeningApproved: () => {
                    const status = (applicant.applicantStatus || '').toLowerCase();
                    
                    if (status.includes('passed hr') || status.includes('p1 passed') || (applicantHRScore && applicantHRScore > 0)) {
                        return 'Yes';
                    }
                    if (status.includes('failed hr') || status.includes('p1 failed')) {
                        return 'No';
                    }
                    return 'Pending';
                },
                panelScreeningApproved: () => {
                    const status = (applicant.applicantStatus || '').toLowerCase();
                    
                    if (status.includes('passed panel') || status.includes('p2 passed') || status.includes('line manager passed') || (applicantPanelScore && applicantPanelScore > 0)) {
                        return 'Yes';
                    }
                    if (status.includes('failed panel') || status.includes('p2 failed') || status.includes('line manager failed')) {
                        return 'No';
                    }
                    return 'Pending';
                },
                finalStatus: () => {
                    const status = (applicant.applicantStatus || '').toLowerCase();
                    
                    if (status.includes('hired') || status.includes('onboarding')) {
                        return 'Hired';
                    }
                    if (status.includes('rejected') || status.includes('failed')) {
                        return 'Rejected';
                    }
                    return 'In Progress';
                }
            };

            // === BUSINESS INTELLIGENCE ANALYSIS ===
            const intelligence = {
                riskLevel: 'Low',
                urgencyLevel: 'Normal',
                recommendations: [],
                nextActions: [],
                performanceIndicators: [],
                processEfficiency: 'Good',
                timeline: {
                    isDelayed: daysInProcess > 30,
                    isUrgent: daysInProcess > 45,
                    isCritical: daysInProcess > 60,
                    isStandard: daysInProcess <= 30
                },
                candidateQuality: 'Average'
            };

            // Risk assessment based on multiple factors
            let riskScore = 0;

            // Timeline risk
            if (daysInProcess > 60) {
                riskScore += 3;
                intelligence.urgencyLevel = 'Critical';
                intelligence.recommendations.push('Immediate decision required - candidate may lose interest due to extremely lengthy process');
                intelligence.nextActions.push('Schedule emergency review meeting within 24 hours');
            } else if (daysInProcess > 45) {
                riskScore += 2;
                intelligence.urgencyLevel = 'High';
                intelligence.recommendations.push('Expedite decision - process approaching maximum acceptable timeframe');
                intelligence.nextActions.push('Prioritize this candidate for immediate review');
            } else if (daysInProcess > 30) {
                riskScore += 1;
                intelligence.urgencyLevel = 'Medium';
                intelligence.recommendations.push('Monitor closely - process timeline approaching best practice limits');
            }

            // Performance risk assessment
            if (totalScore >= 240) {
                intelligence.candidateQuality = 'Excellent';
                intelligence.performanceIndicators.push('Top-tier candidate - scores in top 10%');
                intelligence.nextActions.push('Fast-track this high-performing candidate to prevent losing to competitors');
                riskScore -= 1; // Reduce risk for high performers
            } else if (totalScore >= 180) {
                intelligence.candidateQuality = 'Good';
                intelligence.performanceIndicators.push('Strong candidate with good evaluation scores');
            } else if (totalScore < 150 && totalScore > 0) {
                intelligence.candidateQuality = 'Below Average';
                intelligence.performanceIndicators.push('Below-average scores - carefully consider fit for role');
                intelligence.recommendations.push('Additional evaluation may be needed before proceeding');
                riskScore += 1;
            } else if (totalScore === 0) {
                intelligence.candidateQuality = 'Not Evaluated';
                intelligence.performanceIndicators.push('No evaluation scores available - assessment incomplete');
            }

            // Status-specific intelligence
            const currentStatus = (applicant.applicantStatus || '').toLowerCase();
            
            if (currentStatus.includes('pending hr') || currentStatus.includes('awaiting hr')) {
                intelligence.nextActions.push('HR ACTION REQUIRED: Schedule interview within 3 business days');
                intelligence.processEfficiency = 'Pending HR';
                riskScore += 1;
            }
            
            if (currentStatus.includes('awaiting line manager') || currentStatus.includes('pending line manager')) {
                intelligence.nextActions.push('ESCALATION NEEDED: Contact line manager for interview scheduling');
                intelligence.processEfficiency = 'Pending Line Manager';
                riskScore += 1;
            }

            if (statusProgression.hrScreeningApproved() === 'Yes' && statusProgression.panelScreeningApproved() === 'Pending') {
                intelligence.nextActions.push('Candidate has passed HR screening - coordinate with line manager for next stage');
                intelligence.recommendations.push('Ensure smooth handoff to line manager to maintain momentum');
            }

            if (statusProgression.hrScreeningApproved() === 'No') {
                intelligence.processEfficiency = 'Failed HR Stage';
                intelligence.recommendations.push('Provide feedback to candidate and close application professionally');
            }

            if (statusProgression.panelScreeningApproved() === 'No') {
                intelligence.processEfficiency = 'Failed Panel Stage';
                intelligence.recommendations.push('Document rejection reasons and provide constructive feedback');
            }

            // Determine final risk level
            if (riskScore >= 3) {
                intelligence.riskLevel = 'High';
            } else if (riskScore >= 1) {
                intelligence.riskLevel = 'Medium';
            } else {
                intelligence.riskLevel = 'Low';
            }

            // Process efficiency insights
            if (daysInProcess <= 14 && statusProgression.finalStatus() === 'Hired') {
                intelligence.processEfficiency = 'Excellent';
                intelligence.performanceIndicators.push('Fast-track success - hired within 2 weeks');
            } else if (daysInProcess <= 30) {
                intelligence.processEfficiency = 'Good';
            } else if (daysInProcess <= 45) {
                intelligence.processEfficiency = 'Average';
            } else {
                intelligence.processEfficiency = 'Poor';
            }

            // Department comparison insight
            if (applicant.departments?.deptName) {
                // Get department average processing time for comparison
                const deptApplicants = applicants.filter(a => a.departmentId === applicant.departmentId);
                if (deptApplicants.length > 1) {
                    const deptAvgDays = Math.round(deptApplicants.reduce((sum, a) => {
                        return sum + Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                    }, 0) / deptApplicants.length);
                    
                    if (daysInProcess > deptAvgDays + 10) {
                        intelligence.recommendations.push(`Processing time exceeds ${applicant.departments.deptName} department average by ${daysInProcess - deptAvgDays} days`);
                    } else if (daysInProcess < deptAvgDays - 10) {
                        intelligence.performanceIndicators.push(`Processing faster than ${applicant.departments.deptName} department average`);
                    }
                }
            }

            // Generate priority score for action prioritization
            let priorityScore = 0;
            if (intelligence.riskLevel === 'High') priorityScore += 3;
            else if (intelligence.riskLevel === 'Medium') priorityScore += 2;
            else priorityScore += 1;

            if (intelligence.candidateQuality === 'Excellent') priorityScore += 2;
            if (intelligence.urgencyLevel === 'Critical') priorityScore += 3;
            else if (intelligence.urgencyLevel === 'High') priorityScore += 2;

            intelligence.priorityScore = priorityScore;
            intelligence.priorityLevel = priorityScore >= 6 ? 'Critical' : priorityScore >= 4 ? 'High' : priorityScore >= 2 ? 'Medium' : 'Low';

            // Fetch enhanced status history
            const { data: statusHistory, error: historyError } = await supabase
                .from('chatbot_history')
                .select('message, timestamp, applicantStage')
                .eq('userId', applicant.userId)
                .order('timestamp', { ascending: true });

            let processedHistory = [];
            if (statusHistory && statusHistory.length > 0) {
                processedHistory = statusHistory.map(history => {
                    let messageText = '';
                    if (typeof history.message === 'string') {
                        try {
                            const parsed = JSON.parse(history.message);
                            messageText = parsed.text || history.message;
                        } catch (e) {
                            messageText = history.message;
                        }
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
                processedHistory = [
                    {
                        status: 'Application Submitted',
                        date: new Date(applicant.created_at).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }),
                        notes: 'Initial application received and processed into system'
                    }
                ];
            }

            // Enhanced applicant details with intelligence
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
                hrScreeningApproved: statusProgression.hrScreeningApproved(),
                panelScreeningApproved: statusProgression.panelScreeningApproved(),
                isHired: statusProgression.finalStatus(),
                
                // Scores
                initialScreeningScore: applicantInitialScore || 'N/A',
                hrInterviewScore: applicantHRScore || 'N/A',
                lineManagerScore: applicantPanelScore || 'N/A',
                totalScore: totalScore > 0 ? totalScore : 'N/A',
                
                // Intelligence metrics
                riskLevel: intelligence.riskLevel,
                urgencyLevel: intelligence.urgencyLevel,
                candidateQuality: intelligence.candidateQuality,
                processEfficiency: intelligence.processEfficiency,
                priorityLevel: intelligence.priorityLevel,
                priorityScore: intelligence.priorityScore
            };

            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return res.json({
                success: true,
                applicant: applicantDetails,
                statusHistory: processedHistory,
                intelligence: intelligence,
                generatedOn: generatedOn,
                reportTitle: 'Individual Applicant Status Report (HR) - Intelligence Enhanced'
            });

        } catch (error) {
            console.error('❌ [HR Status Report] Error:', error);
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
            
            console.log('🔍 [HR Timeline Report] Fetching MRF to onboarding timeline data with business intelligence...');
            
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
                    numPersonsRequisitioned,
                    userId,
                    departments!inner(deptName),
                    useraccounts!inner(userEmail)
                `)
                .order('requisitionDate', { ascending: true });

            // Apply date filters
            if (startDate) {
                mrfQuery = mrfQuery.gte('requisitionDate', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                mrfQuery = mrfQuery.lte('requisitionDate', endDateTime.toISOString());
            }
            if (department && department !== 'all') {
                mrfQuery = mrfQuery.eq('departmentId', department);
            }

            const { data: mrfs, error: mrfError } = await mrfQuery;

            if (mrfError) {
                console.error('❌ [HR Timeline Report] Error fetching MRFs:', mrfError);
                return res.status(500).json({ success: false, message: 'Error fetching MRF data: ' + mrfError.message });
            }

            // Get applicants for timeline calculation
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
                console.error('❌ [HR Timeline Report] Error fetching applicants:', applicantError);
                return res.status(500).json({ success: false, message: 'Error fetching applicant data: ' + applicantError.message });
            }

            // Filter for hired candidates
            const hiredApplicants = applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                return status.includes('hired') || status.includes('onboarding');
            });

            console.log(`📊 [HR Timeline Report] Analyzing ${hiredApplicants.length} hired candidates for timeline intelligence`);

            // Fetch scores from assessment tables for hired applicants only
            const hiredUserIds = hiredApplicants.map(h => h.userId);

            const [initialScores, hrScores, panelScores] = await Promise.all([
                supabase.from('applicant_initialscreening_assessment')
                    .select('userId, totalScore')
                    .in('userId', hiredUserIds),
                supabase.from('applicant_hrscreening_assessment')
                    .select('applicantUserid, totalAssessmentRating')
                    .in('applicantUserid', hiredUserIds),
                supabase.from('applicant_panelscreening_assessment')
                    .select('applicantUserId, totalAssessmentRating')
                    .in('applicantUserId', hiredUserIds)
            ]);

            // Create score lookup maps
            const initialScoreMap = new Map();
            const hrScoreMap = new Map();
            const panelScoreMap = new Map();

            if (initialScores.data) {
                initialScores.data.forEach(score => {
                    initialScoreMap.set(score.userId, score.totalScore);
                });
            }

            if (hrScores.data) {
                hrScores.data.forEach(score => {
                    hrScoreMap.set(score.applicantUserid, score.totalAssessmentRating);
                });
            }

            if (panelScores.data) {
                panelScores.data.forEach(score => {
                    panelScoreMap.set(score.applicantUserId, score.totalAssessmentRating);
                });
            }

            // === BUSINESS INTELLIGENCE ANALYSIS ===

            // 1. Timeline Performance Analysis
            const timelineAnalysis = {
                fast: hiredApplicants.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days <= 21; // ≤3 weeks
                }),
                standard: hiredApplicants.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days > 21 && days <= 45; // 3-6 weeks
                }),
                slow: hiredApplicants.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days > 45 && days <= 75; // 6-10 weeks
                }),
                critical: hiredApplicants.filter(h => {
                    const days = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
                    return days > 75; // >10 weeks
                })
            };

            // 2. Department Timeline Comparison
            const departmentTimelines = {};
            hiredApplicants.forEach(applicant => {
                const deptName = applicant.departments?.deptName || 'Unknown';
                if (!departmentTimelines[deptName]) {
                    departmentTimelines[deptName] = {
                        department: deptName,
                        hires: 0,
                        totalDays: 0,
                        fastHires: 0,
                        slowHires: 0,
                        avgScore: 0,
                        scores: []
                    };
                }
                
                const dept = departmentTimelines[deptName];
                const days = Math.floor((new Date() - new Date(applicant.created_at)) / (1000 * 60 * 60 * 24));
                
                dept.hires++;
                dept.totalDays += days;
                if (days <= 30) dept.fastHires++;
                if (days > 60) dept.slowHires++;
                
                const initialScore = initialScoreMap.get(applicant.userId) || 0;
                const hrScore = hrScoreMap.get(applicant.userId) || 0;
                const panelScore = panelScoreMap.get(applicant.userId) || 0;
                const totalScore = initialScore + hrScore + panelScore;
                if (totalScore > 0) dept.scores.push(totalScore);
            });

            // Process department averages and efficiency
            const departmentComparison = Object.values(departmentTimelines).map(dept => {
                dept.avgDays = dept.hires > 0 ? Math.round(dept.totalDays / dept.hires) : 0;
                dept.avgScore = dept.scores.length > 0 ? Math.round(dept.scores.reduce((sum, score) => sum + score, 0) / dept.scores.length) : 0;
                dept.efficiency = dept.avgDays <= 30 ? 'Excellent' : dept.avgDays <= 45 ? 'Good' : dept.avgDays <= 60 ? 'Average' : 'Poor';
                dept.fastHireRate = dept.hires > 0 ? Math.round((dept.fastHires / dept.hires) * 100) : 0;
                return dept;
            }).sort((a, b) => a.avgDays - b.avgDays); // Sort by efficiency (fastest first)

            // 3. Bottleneck Detection Analysis
            const bottleneckAnalysis = {
                stageAnalysis: {
                    hrStage: applicants.filter(a => {
                        const status = (a.applicantStatus || '').toLowerCase();
                        const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                        return (status.includes('pending hr') || status.includes('hr interview')) && days > 14;
                    }).length,
                    lineManagerStage: applicants.filter(a => {
                        const status = (a.applicantStatus || '').toLowerCase();
                        const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                        return (status.includes('pending line manager') || status.includes('panel')) && days > 21;
                    }).length,
                    initialScreening: applicants.filter(a => {
                        const status = (a.applicantStatus || '').toLowerCase();
                        const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                        return status.includes('screening') && days > 7;
                    }).length
                },
                criticalBottleneck: null,
                bottleneckSeverity: 'Low'
            };

            // Identify primary bottleneck
            const bottlenecks = [
                { stage: 'HR Interview Stage', count: bottleneckAnalysis.stageAnalysis.hrStage },
                { stage: 'Line Manager Review', count: bottleneckAnalysis.stageAnalysis.lineManagerStage },
                { stage: 'Initial Screening', count: bottleneckAnalysis.stageAnalysis.initialScreening }
            ];

            const primaryBottleneck = bottlenecks.reduce((max, current) => 
                current.count > max.count ? current : max
            );

            if (primaryBottleneck.count > 0) {
                bottleneckAnalysis.criticalBottleneck = primaryBottleneck.stage;
                bottleneckAnalysis.bottleneckSeverity = primaryBottleneck.count >= 10 ? 'High' : 
                                                    primaryBottleneck.count >= 5 ? 'Medium' : 'Low';
            }

            // 4. Process Optimization Analysis
            const optimizationAnalysis = {
                processHealth: 'Good',
                healthScore: 0,
                optimizationOpportunities: [],
                processEfficiencies: [],
                criticalIssues: []
            };

            // Calculate process health score (0-100)
            let healthScore = 0;

            // Timeline efficiency (40% of score)
            const avgTimeToHire = hiredApplicants.length > 0 ? Math.round(hiredApplicants.reduce((sum, h) => {
                return sum + Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
            }, 0) / hiredApplicants.length) : 0;

            if (avgTimeToHire <= 21) healthScore += 40;
            else if (avgTimeToHire <= 35) healthScore += 30;
            else if (avgTimeToHire <= 50) healthScore += 20;
            else healthScore += 10;

            // Fast hire rate (30% of score)
            const fastHireRate = hiredApplicants.length > 0 ? 
                (timelineAnalysis.fast.length / hiredApplicants.length) * 100 : 0;
            healthScore += Math.min(fastHireRate * 0.3, 30);

            // Bottleneck severity (30% of score - reverse scoring)
            if (bottleneckAnalysis.bottleneckSeverity === 'Low') healthScore += 30;
            else if (bottleneckAnalysis.bottleneckSeverity === 'Medium') healthScore += 15;
            else healthScore += 5;

            optimizationAnalysis.healthScore = Math.round(healthScore);
            optimizationAnalysis.processHealth = healthScore >= 80 ? 'Excellent' : 
                                                healthScore >= 60 ? 'Good' : 
                                                healthScore >= 40 ? 'Fair' : 'Poor';

            // 5. MRF Fulfillment Timeline Analysis
            const mrfAnalysis = {
                totalMRFs: mrfs.length,
                avgMRFAge: 0,
                overdueMRFs: 0,
                fulfillmentRate: 0,
                avgFulfillmentTime: 0
            };

            if (mrfs.length > 0) {
                // Calculate MRF metrics
                let totalMRFDays = 0;
                let overdue = 0;
                let fulfilled = 0;
                let fulfillmentDays = 0;

                mrfs.forEach(mrf => {
                    const mrfAge = Math.floor((new Date() - new Date(mrf.requisitionDate)) / (1000 * 60 * 60 * 24));
                    totalMRFDays += mrfAge;

                    const isOverdue = new Date() > new Date(mrf.requiredDate);
                    if (isOverdue) overdue++;

                    // Check if MRF has related hires
                    const relatedHires = hiredApplicants.filter(h => {
                        const hireDate = new Date(h.created_at);
                        const mrfDate = new Date(mrf.requisitionDate);
                        return h.departmentId === mrf.departmentId && hireDate >= mrfDate;
                    });

                    if (relatedHires.length >= mrf.numPersonsRequisitioned) {
                        fulfilled++;
                        fulfillmentDays += mrfAge;
                    }
                });

                mrfAnalysis.avgMRFAge = Math.round(totalMRFDays / mrfs.length);
                mrfAnalysis.overdueMRFs = overdue;
                mrfAnalysis.fulfillmentRate = Math.round((fulfilled / mrfs.length) * 100);
                mrfAnalysis.avgFulfillmentTime = fulfilled > 0 ? Math.round(fulfillmentDays / fulfilled) : 0;
            }

            // === INTELLIGENT INSIGHTS GENERATION ===
            const insights = [];
            const actionItems = [];
            const recommendations = [];

            // Timeline Performance Insights
            if (timelineAnalysis.fast.length > timelineAnalysis.slow.length + timelineAnalysis.critical.length) {
                insights.push(`🚀 Strong timeline performance - ${timelineAnalysis.fast.length} fast hires (≤21 days) exceed slow hires`);
                optimizationAnalysis.processEfficiencies.push('Fast hiring process maintains competitive advantage');
            }

            if (timelineAnalysis.critical.length > 0) {
                insights.push(`🚨 ${timelineAnalysis.critical.length} critical timeline delays (>75 days) require immediate attention`);
                actionItems.push(`Investigate and resolve ${timelineAnalysis.critical.length} extremely delayed hiring processes`);
                optimizationAnalysis.criticalIssues.push('Excessive timeline delays');
            }

            // Bottleneck Insights
            if (bottleneckAnalysis.criticalBottleneck) {
                insights.push(`🔴 Critical bottleneck identified at "${bottleneckAnalysis.criticalBottleneck}" - ${primaryBottleneck.count} candidates affected`);
                
                if (bottleneckAnalysis.criticalBottleneck.includes('HR')) {
                    actionItems.push('Increase HR interview capacity or streamline HR interview process');
                    recommendations.push('Consider additional HR staff or automated pre-screening tools');
                } else if (bottleneckAnalysis.criticalBottleneck.includes('Line Manager')) {
                    actionItems.push('Coordinate with line managers to expedite candidate reviews');
                    recommendations.push('Implement line manager interview scheduling automation');
                } else if (bottleneckAnalysis.criticalBottleneck.includes('Screening')) {
                    actionItems.push('Optimize initial screening process to reduce processing time');
                    recommendations.push('Implement automated screening questionnaires');
                }
            }

            // Department Performance Insights
            if (departmentComparison.length > 1) {
                const fastest = departmentComparison[0];
                const slowest = departmentComparison[departmentComparison.length - 1];

                if (fastest.avgDays <= 30) {
                    insights.push(`🏆 ${fastest.department} achieves excellent timeline efficiency (${fastest.avgDays} days avg)`);
                    recommendations.push(`Share ${fastest.department}'s best practices with other departments`);
                }

                if (slowest.avgDays > 60) {
                    insights.push(`📉 ${slowest.department} shows slow timeline performance (${slowest.avgDays} days avg) - needs support`);
                    actionItems.push(`Provide process improvement support to ${slowest.department}`);
                    optimizationAnalysis.criticalIssues.push(`${slowest.department} slow performance`);
                }
            }

            // MRF Insights
            if (mrfAnalysis.overdueMRFs > 0) {
                insights.push(`⏰ ${mrfAnalysis.overdueMRFs} MRFs are overdue - review requirements and timelines`);
                actionItems.push(`Address ${mrfAnalysis.overdueMRFs} overdue MRF requirements`);
            }

            if (mrfAnalysis.fulfillmentRate < 70) {
                insights.push(`📊 Low MRF fulfillment rate (${mrfAnalysis.fulfillmentRate}%) indicates process inefficiencies`);
                recommendations.push('Review MRF requirements and improve hiring process efficiency');
            } else if (mrfAnalysis.fulfillmentRate >= 85) {
                insights.push(`✅ Excellent MRF fulfillment rate (${mrfAnalysis.fulfillmentRate}%) demonstrates effective recruitment`);
            }

            // Process Health Insights
            if (optimizationAnalysis.healthScore >= 80) {
                insights.push(`💪 Excellent process health (${optimizationAnalysis.healthScore}/100) - recruitment system performing well`);
            } else if (optimizationAnalysis.healthScore < 60) {
                insights.push(`⚠️ Poor process health (${optimizationAnalysis.healthScore}/100) - comprehensive review needed`);
                actionItems.push('Conduct comprehensive recruitment process review and optimization');
                optimizationAnalysis.criticalIssues.push('Overall process health below acceptable levels');
            }

            // Generate timeline data with intelligence flags
            const timelineData = hiredApplicants.map(timeline => {
                const days = Math.floor((new Date() - new Date(timeline.created_at)) / (1000 * 60 * 60 * 24));
                
                return {
                    applicantId: timeline.applicantId,
                    name: `${timeline.firstName} ${timeline.lastName}`,
                    position: timeline.jobpositions?.jobTitle || 'N/A',
                    department: timeline.departments?.deptName || 'N/A',
                    applicationDate: timeline.created_at ? 
                        new Date(timeline.created_at).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'N/A',
                    totalDays: days,
                    status: timeline.applicantStatus || 'Hired',
                    
                    // Intelligence flags
                    timelineCategory: days <= 21 ? 'Fast' : days <= 45 ? 'Standard' : days <= 75 ? 'Slow' : 'Critical',
                    efficiencyFlag: days <= 21 ? 'excellent' : days <= 45 ? 'good' : days <= 75 ? 'average' : 'poor',
                    
                    // Estimated breakdown (would ideally come from actual workflow data)
                    mrfToJobPosting: Math.min(Math.floor(days * 0.1), 7),
                    jobPostingToInitialInterview: Math.min(Math.floor(days * 0.3), 14),
                    initialInterviewToFinalInterview: Math.min(Math.floor(days * 0.4), 21),
                    finalInterviewToOnboarding: Math.max(days - Math.floor(days * 0.8), 3)
                };
            });

            // Enhanced summary statistics
            const summaryStats = {
                averageMrfToOnboarding: avgTimeToHire,
                shortestTimeline: timelineData.length > 0 ? Math.min(...timelineData.map(t => t.totalDays)) : 0,
                longestTimeline: timelineData.length > 0 ? Math.max(...timelineData.map(t => t.totalDays)) : 0,
                targetTimeline: 30,
                processHealthScore: optimizationAnalysis.healthScore,
                bottleneckSeverity: bottleneckAnalysis.bottleneckSeverity,
                fastHireRate: Math.round(fastHireRate),
                
                averageStages: {
                    mrfToJobPosting: timelineData.length > 0 ? Math.round(timelineData.reduce((sum, t) => sum + t.mrfToJobPosting, 0) / timelineData.length) : 0,
                    jobPostingToInitialInterview: timelineData.length > 0 ? Math.round(timelineData.reduce((sum, t) => sum + t.jobPostingToInitialInterview, 0) / timelineData.length) : 0,
                    initialInterviewToFinalInterview: timelineData.length > 0 ? Math.round(timelineData.reduce((sum, t) => sum + t.initialInterviewToFinalInterview, 0) / timelineData.length) : 0,
                    finalInterviewToOnboarding: timelineData.length > 0 ? Math.round(timelineData.reduce((sum, t) => sum + t.finalInterviewToOnboarding, 0) / timelineData.length) : 0
                }
            };

            // Monthly breakdown with intelligence
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
                        totalDays: 0,
                        fastHires: 0,
                        slowHires: 0
                    };
                }
                
                const month = monthlyBreakdown[monthKey];
                month.hires++;
                month.totalDays += timeline.totalDays;
                if (timeline.totalDays <= 30) month.fastHires++;
                if (timeline.totalDays > 60) month.slowHires++;
            });

            // Calculate monthly averages and efficiency
            const monthlyData = Object.values(monthlyBreakdown).map(month => {
                month.averageDays = month.hires > 0 ? Math.round(month.totalDays / month.hires) : 0;
                month.efficiency = month.averageDays <= 30 ? 'Excellent' : 
                                month.averageDays <= 45 ? 'Good' : 
                                month.averageDays <= 60 ? 'Average' : 'Poor';
                return month;
            }).sort((a, b) => a.month.localeCompare(b.month));

            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return res.json({
                success: true,
                summaryStats: summaryStats,
                timelineData: timelineData,
                monthlyData: monthlyData,
                totalMRFs: mrfs.length,
                totalHired: hiredApplicants.length,
                insights: insights,
                actionItems: actionItems,
                recommendations: recommendations,
                intelligence: {
                    timelineAnalysis,
                    departmentComparison,
                    bottleneckAnalysis,
                    optimizationAnalysis,
                    mrfAnalysis
                },
                generatedOn: generatedOn,
                reportTitle: 'MRF To Onboarding Timeline Report (HR) - Intelligence Enhanced'
            });

        } catch (error) {
            console.error('❌ [HR Timeline Report] Error:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    getMRFEfficiencyReport: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { startDate, endDate, department, format } = req.query;
            
            console.log('🔍 [HR MRF Efficiency] Fetching MRF efficiency data with business intelligence...');
            
            // Get MRFs with enhanced data
            let mrfQuery = supabase
                .from('mrf')
                .select(`
                    mrfId,
                    positionTitle,
                    requisitionDate,
                    requiredDate,
                    numPersonsRequisitioned,
                    status,
                    departmentId,
                    userId,
                    departments!inner(deptName),
                    useraccounts!inner(userEmail)
                `)
                .order('requisitionDate', { ascending: false });

            // Apply date filters
            if (startDate) {
                mrfQuery = mrfQuery.gte('requisitionDate', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                mrfQuery = mrfQuery.lte('requisitionDate', endDateTime.toISOString());
            }
            if (department && department !== 'all') {
                mrfQuery = mrfQuery.eq('departmentId', department);
            }

            const { data: mrfs, error: mrfError } = await mrfQuery;

            if (mrfError) {
                console.error('❌ [HR MRF Efficiency] Error fetching MRFs:', mrfError);
                throw mrfError;
            }

            // Get all applicants for hire matching
            const { data: allApplicants, error: applicantsError } = await supabase
                .from('applicantaccounts')
                .select(`
                    applicantId,
                    applicantStatus,
                    created_at,
                    departmentId,
                    jobId,
                    initialScreeningScore,
                    hrInterviewFormScore,
                    lineManagerFormEvalScore,
                    jobpositions!inner(jobTitle),
                    departments!inner(deptName)
                `);

            if (applicantsError) {
                console.error('❌ [HR MRF Efficiency] Error fetching applicants:', applicantsError);
            }

            // Filter hired applicants
            const hiredApplicants = (allApplicants || []).filter(applicant => {
                const status = (applicant.applicantStatus || '').toString().toLowerCase();
                return status.includes('hired') || status.includes('onboarding');
            });

            console.log(`📊 [HR MRF Efficiency] Analyzing ${mrfs.length} MRFs and ${hiredApplicants.length} hires for intelligence`);

            // === BUSINESS INTELLIGENCE ANALYSIS ===

            // 1. MRF Performance Analysis
            const mrfData = mrfs.map(mrf => {
                // Smart hire attribution
                const relatedHires = hiredApplicants.filter(applicant => {
                    const hireDate = new Date(applicant.created_at);
                    const mrfDate = new Date(mrf.requisitionDate);
                    const mrfDeadline = new Date(mrf.requiredDate);
                    
                    return applicant.departmentId === mrf.departmentId && 
                        hireDate >= mrfDate &&
                        hireDate <= new Date(mrfDeadline.getTime() + (90 * 24 * 60 * 60 * 1000));
                });

                const personnelHired = relatedHires.length;
                const fillRate = Math.round((personnelHired / mrf.numPersonsRequisitioned) * 100);
                const daysOpen = Math.floor((new Date() - new Date(mrf.requisitionDate)) / (1000 * 60 * 60 * 24));
                const isOverdue = new Date() > new Date(mrf.requiredDate);
                const daysOverdue = isOverdue ? Math.floor((new Date() - new Date(mrf.requiredDate)) / (1000 * 60 * 60 * 24)) : 0;
                
                // Intelligence metrics
                const urgencyLevel = daysOverdue > 30 ? 'Critical' : daysOverdue > 14 ? 'High' : daysOverdue > 0 ? 'Medium' : 'Normal';
                const performanceLevel = fillRate >= 100 ? 'Excellent' : fillRate >= 75 ? 'Good' : fillRate >= 50 ? 'Average' : 'Poor';
                const efficiencyScore = Math.max(0, 100 - (daysOpen - 30)); // Score based on timeline efficiency

                return {
                    mrfId: mrf.mrfId,
                    positionTitle: mrf.positionTitle,
                    department: mrf.departments.deptName,
                    lineManager: mrf.useraccounts.userEmail,
                    requisitionDate: new Date(mrf.requisitionDate).toLocaleDateString(),
                    requiredDate: new Date(mrf.requiredDate).toLocaleDateString(),
                    personnelRequired: mrf.numPersonsRequisitioned,
                    personnelHired: personnelHired,
                    fillRate: fillRate,
                    daysOpen: daysOpen,
                    daysOverdue: daysOverdue,
                    isOverdue: isOverdue,
                    status: mrf.status,
                    urgencyLevel: urgencyLevel,
                    performanceLevel: performanceLevel,
                    efficiencyScore: Math.max(0, efficiencyScore),
                    riskLevel: urgencyLevel === 'Critical' || performanceLevel === 'Poor' ? 'High' : 
                            urgencyLevel === 'High' || performanceLevel === 'Average' ? 'Medium' : 'Low'
                };
            });

            // 2. Department Performance Intelligence
            const departmentStats = {};
            mrfData.forEach(mrf => {
                if (!departmentStats[mrf.department]) {
                    departmentStats[mrf.department] = {
                        totalMRFs: 0,
                        totalRequired: 0,
                        totalHired: 0,
                        completedMRFs: 0,
                        overdueMRFs: 0,
                        totalDaysOpen: 0,
                        totalEfficiencyScore: 0,
                        riskMRFs: 0
                    };
                }
                
                const dept = departmentStats[mrf.department];
                dept.totalMRFs++;
                dept.totalRequired += mrf.personnelRequired;
                dept.totalHired += mrf.personnelHired;
                dept.totalDaysOpen += mrf.daysOpen;
                dept.totalEfficiencyScore += mrf.efficiencyScore;
                if (mrf.fillRate >= 100) dept.completedMRFs++;
                if (mrf.isOverdue) dept.overdueMRFs++;
                if (mrf.riskLevel === 'High') dept.riskMRFs++;
            });

            // Enhanced department comparison with intelligence metrics
            const departmentComparison = Object.entries(departmentStats).map(([deptName, stats]) => {
                const fillRate = stats.totalRequired > 0 ? Math.round((stats.totalHired / stats.totalRequired) * 100) : 0;
                const completionRate = stats.totalMRFs > 0 ? Math.round((stats.completedMRFs / stats.totalMRFs) * 100) : 0;
                const avgDaysOpen = stats.totalMRFs > 0 ? Math.round(stats.totalDaysOpen / stats.totalMRFs) : 0;
                const avgEfficiencyScore = stats.totalMRFs > 0 ? Math.round(stats.totalEfficiencyScore / stats.totalMRFs) : 0;
                const riskRate = stats.totalMRFs > 0 ? Math.round((stats.riskMRFs / stats.totalMRFs) * 100) : 0;
                
                return {
                    department: deptName,
                    totalMRFs: stats.totalMRFs,
                    totalRequired: stats.totalRequired,
                    totalHired: stats.totalHired,
                    fillRate: fillRate,
                    completionRate: completionRate,
                    avgDaysOpen: avgDaysOpen,
                    overdueMRFs: stats.overdueMRFs,
                    avgEfficiencyScore: avgEfficiencyScore,
                    riskRate: riskRate,
                    performanceGrade: avgEfficiencyScore >= 80 ? 'A' : avgEfficiencyScore >= 65 ? 'B' : avgEfficiencyScore >= 50 ? 'C' : 'D',
                    deptEfficiency: fillRate >= 85 && avgDaysOpen <= 35 ? 'Excellent' : 
                                fillRate >= 70 && avgDaysOpen <= 50 ? 'Good' : 
                                fillRate >= 50 && avgDaysOpen <= 65 ? 'Average' : 'Needs Improvement'
                };
            }).sort((a, b) => b.avgEfficiencyScore - a.avgEfficiencyScore);

            // 3. Line Manager Performance Intelligence
            const lineManagerStats = {};
            mrfData.forEach(mrf => {
                if (!lineManagerStats[mrf.lineManager]) {
                    lineManagerStats[mrf.lineManager] = {
                        totalMRFs: 0,
                        totalRequired: 0,
                        totalHired: 0,
                        totalDaysOpen: 0,
                        overdueMRFs: 0,
                        totalEfficiencyScore: 0,
                        urgentMRFs: 0
                    };
                }
                
                const manager = lineManagerStats[mrf.lineManager];
                manager.totalMRFs++;
                manager.totalRequired += mrf.personnelRequired;
                manager.totalHired += mrf.personnelHired;
                manager.totalDaysOpen += mrf.daysOpen;
                manager.totalEfficiencyScore += mrf.efficiencyScore;
                if (mrf.isOverdue) manager.overdueMRFs++;
                if (mrf.urgencyLevel === 'Critical' || mrf.urgencyLevel === 'High') manager.urgentMRFs++;
            });

            const lineManagerComparison = Object.entries(lineManagerStats).map(([managerEmail, stats]) => {
                const fillRate = stats.totalRequired > 0 ? Math.round((stats.totalHired / stats.totalRequired) * 100) : 0;
                const avgDaysOpen = stats.totalMRFs > 0 ? Math.round(stats.totalDaysOpen / stats.totalMRFs) : 0;
                const avgEfficiencyScore = stats.totalMRFs > 0 ? Math.round(stats.totalEfficiencyScore / stats.totalMRFs) : 0;
                const urgencyRate = stats.totalMRFs > 0 ? Math.round((stats.urgentMRFs / stats.totalMRFs) * 100) : 0;
                
                return {
                    lineManager: managerEmail,
                    totalMRFs: stats.totalMRFs,
                    totalRequired: stats.totalRequired,
                    totalHired: stats.totalHired,
                    fillRate: fillRate,
                    avgDaysOpen: avgDaysOpen,
                    overdueMRFs: stats.overdueMRFs,
                    avgEfficiencyScore: avgEfficiencyScore,
                    urgencyRate: urgencyRate,
                    managerEfficiency: avgEfficiencyScore >= 75 ? 'High Performer' : 
                                    avgEfficiencyScore >= 60 ? 'Good Performer' : 
                                    avgEfficiencyScore >= 45 ? 'Average Performer' : 'Needs Support'
                };
            }).sort((a, b) => b.avgEfficiencyScore - a.avgEfficiencyScore);

            // 4. Trend Analysis with Intelligence
            const monthlyTrends = {};
            const currentDate = new Date();
            
            // Initialize last 6 months
            for (let i = 5; i >= 0; i--) {
                const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
                const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
                monthlyTrends[monthKey] = {
                    month: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                    mrfsCreated: 0,
                    personnelRequired: 0,
                    personnelHired: 0,
                    avgEfficiency: 0,
                    totalEfficiency: 0
                };
            }

            // Populate monthly data
            mrfData.forEach(mrf => {
                const mrfDate = new Date(mrf.requisitionDate);
                const monthKey = `${mrfDate.getFullYear()}-${String(mrfDate.getMonth() + 1).padStart(2, '0')}`;
                
                if (monthlyTrends[monthKey]) {
                    monthlyTrends[monthKey].mrfsCreated++;
                    monthlyTrends[monthKey].personnelRequired += mrf.personnelRequired;
                    monthlyTrends[monthKey].personnelHired += mrf.personnelHired;
                    monthlyTrends[monthKey].totalEfficiency += mrf.efficiencyScore;
                }
            });

            // Calculate monthly averages
            const monthlyData = Object.values(monthlyTrends).map(month => {
                month.avgEfficiency = month.mrfsCreated > 0 ? Math.round(month.totalEfficiency / month.mrfsCreated) : 0;
                month.monthlyFillRate = month.personnelRequired > 0 ? Math.round((month.personnelHired / month.personnelRequired) * 100) : 0;
                month.trendDirection = 'stable'; // Would calculate based on previous month in real implementation
                return month;
            });

            // 5. Predictive Risk Analysis
            const riskAnalysis = {
                highRiskMRFs: mrfData.filter(m => m.riskLevel === 'High'),
                criticalMRFs: mrfData.filter(m => m.urgencyLevel === 'Critical'),
                underperformingDepts: departmentComparison.filter(d => d.performanceGrade === 'D'),
                atRiskManagers: lineManagerComparison.filter(m => m.managerEfficiency === 'Needs Support'),
                processBottlenecks: []
            };

            // Identify process bottlenecks
            if (riskAnalysis.highRiskMRFs.length > mrfData.length * 0.3) {
                riskAnalysis.processBottlenecks.push('High volume of risky MRFs indicates systemic issues');
            }
            if (departmentComparison.some(d => d.avgDaysOpen > 60)) {
                riskAnalysis.processBottlenecks.push('Some departments show excessive processing times');
            }
            if (lineManagerComparison.some(m => m.urgencyRate > 40)) {
                riskAnalysis.processBottlenecks.push('High urgency rates suggest planning or capacity issues');
            }

            // === INTELLIGENT INSIGHTS GENERATION ===
            const insights = [];
            const actionItems = [];
            const recommendations = [];
            const optimizations = [];

            // Overall Performance Insights
            const totalMRFs = mrfs.length;
            const totalRequired = mrfs.reduce((sum, mrf) => sum + mrf.numPersonsRequisitioned, 0);
            const totalHired = mrfData.reduce((sum, mrf) => sum + mrf.personnelHired, 0);
            const overallFillRate = totalRequired > 0 ? Math.round((totalHired / totalRequired) * 100) : 0;
            const overdueMRFs = mrfData.filter(mrf => mrf.isOverdue).length;
            const avgDaysOpen = mrfData.length > 0 ? Math.round(mrfData.reduce((sum, mrf) => sum + mrf.daysOpen, 0) / mrfData.length) : 0;

            if (overallFillRate >= 85) {
                insights.push(`🎯 Excellent overall fill rate (${overallFillRate}%) demonstrates strong MRF fulfillment capability`);
            } else if (overallFillRate < 60) {
                insights.push(`📉 Low overall fill rate (${overallFillRate}%) indicates significant efficiency challenges`);
                actionItems.push('Conduct comprehensive review of MRF fulfillment processes');
                recommendations.push('Consider revised hiring strategies and resource allocation');
            }

            // Department Performance Insights
            if (departmentComparison.length > 1) {
                const topDept = departmentComparison[0];
                const bottomDept = departmentComparison[departmentComparison.length - 1];

                if (topDept.performanceGrade === 'A') {
                    insights.push(`🏆 ${topDept.department} leads with grade ${topDept.performanceGrade} performance (${topDept.avgEfficiencyScore}% efficiency)`);
                    optimizations.push(`Replicate ${topDept.department}'s successful practices across other departments`);
                }

                if (bottomDept.performanceGrade === 'D') {
                    insights.push(`🚨 ${bottomDept.department} requires urgent attention with grade ${bottomDept.performanceGrade} performance`);
                    actionItems.push(`Implement improvement plan for ${bottomDept.department} department immediately`);
                    recommendations.push(`Provide dedicated support and resources to ${bottomDept.department}`);
                }
            }

            // Manager Performance Insights
            if (lineManagerComparison.length > 1) {
                const topManager = lineManagerComparison[0];
                const strugglingManagers = lineManagerComparison.filter(m => m.managerEfficiency === 'Needs Support');

                if (topManager.managerEfficiency === 'High Performer') {
                    insights.push(`⭐ Top performing line manager achieves ${topManager.avgEfficiencyScore}% efficiency score`);
                    optimizations.push('Share top performer best practices through manager training sessions');
                }

                if (strugglingManagers.length > 0) {
                    insights.push(`📚 ${strugglingManagers.length} line managers need additional support and training`);
                    actionItems.push(`Provide targeted training for ${strugglingManagers.length} underperforming managers`);
                    recommendations.push('Implement manager mentorship program for MRF efficiency improvement');
                }
            }

            // Risk and Urgency Insights
            if (riskAnalysis.criticalMRFs.length > 0) {
                insights.push(`🚨 ${riskAnalysis.criticalMRFs.length} MRFs in critical status require immediate escalation`);
                actionItems.push(`Emergency review session for ${riskAnalysis.criticalMRFs.length} critical MRFs within 48 hours`);
            }

            if (overdueMRFs > totalMRFs * 0.2) {
                insights.push(`⏰ High overdue rate (${Math.round((overdueMRFs/totalMRFs)*100)}%) suggests timeline management issues`);
                recommendations.push('Implement better deadline tracking and early warning systems');
            }

            // Trend Insights
            const recentMonths = monthlyData.slice(-2);
            if (recentMonths.length === 2) {
                const trend = recentMonths[1].avgEfficiency - recentMonths[0].avgEfficiency;
                if (trend > 10) {
                    insights.push(`📈 Positive efficiency trend (+${trend}%) shows process improvements are working`);
                } else if (trend < -10) {
                    insights.push(`📉 Declining efficiency trend (${trend}%) requires process intervention`);
                    actionItems.push('Investigate causes of declining efficiency and implement corrective measures');
                }
            }

            // Process Optimization Insights
            if (avgDaysOpen > 50) {
                insights.push(`⚠️ Average processing time (${avgDaysOpen} days) exceeds recommended limits`);
                optimizations.push('Streamline MRF approval and fulfillment processes to reduce cycle time');
            }

            if (riskAnalysis.processBottlenecks.length > 0) {
                insights.push(`🔧 ${riskAnalysis.processBottlenecks.length} process bottlenecks identified for optimization`);
                optimizations.push('Address identified bottlenecks through process reengineering');
            }

            // Enhanced summary with intelligence metrics
            const summary = {
                totalMRFs,
                totalRequired,
                totalHired,
                overallFillRate,
                overdueMRFs,
                completedMRFs: mrfData.filter(mrf => mrf.fillRate >= 100).length,
                avgDaysOpen,
                // Intelligence metrics
                avgEfficiencyScore: mrfData.length > 0 ? Math.round(mrfData.reduce((sum, mrf) => sum + mrf.efficiencyScore, 0) / mrfData.length) : 0,
                highRiskMRFs: riskAnalysis.highRiskMRFs.length,
                criticalMRFs: riskAnalysis.criticalMRFs.length,
                topPerformingDept: departmentComparison[0]?.department || 'N/A',
                improvementOpportunities: optimizations.length,
                processHealth: avgDaysOpen <= 35 && overallFillRate >= 75 ? 'Healthy' : 
                            avgDaysOpen <= 50 && overallFillRate >= 60 ? 'Fair' : 'Needs Attention'
            };

            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            return res.json({
                success: true,
                summary: summary,
                mrfData: mrfData,
                departmentComparison: departmentComparison,
                lineManagerComparison: lineManagerComparison,
                monthlyData: monthlyData,
                insights: insights,
                actionItems: actionItems,
                recommendations: recommendations,
                optimizations: optimizations,
                intelligence: {
                    riskAnalysis,
                    departmentStats: Object.values(departmentStats),
                    lineManagerStats: Object.values(lineManagerStats)
                },
                generatedOn: generatedOn,
                reportTitle: 'MRF Efficiency Analysis Report (HR) - Intelligence Enhanced'
            });

        } catch (error) {
            console.error('❌ [HR MRF Efficiency] Error:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Internal server error: ' + error.message 
            });
        }
    },

    getOffboardingReports: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            const { startDate, endDate, type, format } = req.query;
            
            console.log('🔍 [Offboarding Reports] Fetching offboarding data...');
            console.log('📅 [Offboarding Reports] Filters:', { startDate, endDate, type, format });
            
            // Build query for offboarding requests (without joins)
            let query = supabase
                .from('offboarding_requests')
                .select(`
                    requestId,
                    userId,
                    offboardingType,
                    reason,
                    message,
                    last_day,
                    status,
                    created_at,
                    notice_period_start,
                    clearance_sent_date,
                    employee_completion_date,
                    hr_decision_date
                `)
                .order('created_at', { ascending: false });

            // Apply date filters
            if (startDate) {
                query = query.gte('created_at', startDate);
                console.log('📅 [Offboarding Reports] Applied start date filter:', startDate);
            }
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                query = query.lte('created_at', endDateTime.toISOString());
                console.log('📅 [Offboarding Reports] Applied end date filter:', endDateTime.toISOString());
            }

            // Apply type filter
            if (type && type !== 'all') {
                query = query.eq('offboardingType', type);
                console.log('📋 [Offboarding Reports] Applied type filter:', type);
            }

            const { data: offboardingData, error } = await query;

            if (error) {
                console.error('❌ [Offboarding Reports] Error fetching data:', error);
                return res.status(500).json({ success: false, message: 'Error fetching offboarding data: ' + error.message });
            }

            console.log(`✅ [Offboarding Reports] Found ${offboardingData.length} offboarding requests`);

            if (offboardingData.length === 0) {
                return res.json({
                    success: true,
                    data: [],
                    summary: {
                        totalRequests: 0,
                        resignations: 0,
                        retirements: 0,
                        pending: 0,
                        inProgress: 0,
                        completed: 0
                    },
                    monthlyData: [],
                    generatedOn: new Date().toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    reportTitle: 'Resignation & Retirement Tracker Report (HR)'
                });
            }

            // Get unique userIds from offboarding requests
            const userIds = [...new Set(offboardingData.map(request => request.userId))];
            
            // Fetch user emails separately
            const { data: userAccounts, error: userError } = await supabase
                .from('useraccounts')
                .select('userId, userEmail')
                .in('userId', userIds);

            if (userError) {
                console.error('❌ [Offboarding Reports] Error fetching user accounts:', userError);
                return res.status(500).json({ success: false, message: 'Error fetching user accounts: ' + userError.message });
            }

            // Fetch staff accounts separately
            const { data: staffAccounts, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName, departmentId')
                .in('userId', userIds);

            if (staffError) {
                console.error('❌ [Offboarding Reports] Error fetching staff accounts:', staffError);
                return res.status(500).json({ success: false, message: 'Error fetching staff accounts: ' + staffError.message });
            }

            // Get unique departmentIds
            const departmentIds = [...new Set(staffAccounts.map(staff => staff.departmentId).filter(Boolean))];
            
            // Fetch departments separately
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName')
                .in('departmentId', departmentIds);

            if (deptError) {
                console.error('❌ [Offboarding Reports] Error fetching departments:', deptError);
                return res.status(500).json({ success: false, message: 'Error fetching departments: ' + deptError.message });
            }

            // Calculate summary statistics
            const summary = {
                totalRequests: offboardingData.length,
                resignations: offboardingData.filter(r => r.offboardingType === 'Resignation').length,
                retirements: offboardingData.filter(r => r.offboardingType === 'Retirement').length,
                pending: offboardingData.filter(r => r.status === 'Pending HR').length,
                inProgress: offboardingData.filter(r => 
                    r.status === 'Sent to Employee' || r.status === 'Completed by Employee'
                ).length,
                completed: offboardingData.filter(r => r.status === 'Completed').length
            };

            // Process data for display by combining the separate queries
            const processedData = offboardingData.map(request => {
                // Find corresponding user account
                const userAccount = userAccounts.find(user => user.userId === request.userId);
                
                // Find corresponding staff account
                const staffAccount = staffAccounts.find(staff => staff.userId === request.userId);
                
                // Find corresponding department
                const department = departments.find(dept => dept.departmentId === staffAccount?.departmentId);

                // Calculate notice period
                let noticePeriodDays = null;
                if (request.notice_period_start && request.last_day) {
                    const startDate = new Date(request.notice_period_start);
                    const endDate = new Date(request.last_day);
                    noticePeriodDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
                }

                return {
                    requestId: request.requestId,
                    timestamp: new Date(request.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit' 
                    }),
                    employeeName: staffAccount ? `${staffAccount.firstName} ${staffAccount.lastName}` : 'Unknown Employee',
                    department: department ? department.deptName : 'Unknown Department',
                    type: request.offboardingType || 'Not Specified',
                    reason: request.reason || request.message || 'Not Provided',
                    lastDay: request.last_day ? 
                        new Date(request.last_day).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'Not Set',
                    noticePeriodStart: request.notice_period_start ? 
                        new Date(request.notice_period_start).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'Not Set',
                    noticePeriodDays: noticePeriodDays || 'N/A',
                    clearanceSent: request.clearance_sent_date ? 
                        new Date(request.clearance_sent_date).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'Not Sent',
                    employeeCompletion: request.employee_completion_date ? 
                        new Date(request.employee_completion_date).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit' 
                        }) : 'Not Completed',
                    status: request.status || 'Pending'
                };
            });

            // Monthly breakdown
            const monthlyBreakdown = {};
            offboardingData.forEach(request => {
                const date = new Date(request.created_at);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                
                if (!monthlyBreakdown[monthKey]) {
                    monthlyBreakdown[monthKey] = {
                        month: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
                        resignations: 0,
                        retirements: 0,
                        total: 0
                    };
                }
                
                monthlyBreakdown[monthKey].total++;
                if (request.offboardingType === 'Resignation') {
                    monthlyBreakdown[monthKey].resignations++;
                } else if (request.offboardingType === 'Retirement') {
                    monthlyBreakdown[monthKey].retirements++;
                }
            });

            const monthlyData = Object.values(monthlyBreakdown).sort((a, b) => a.month.localeCompare(b.month));

            // Add generation timestamp
            const generatedOn = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            console.log('📊 [Offboarding Reports] Summary stats:', summary);

            if (format === 'pdf') {
                console.log('📄 [Offboarding Reports] PDF format requested');
                return res.json({
                    success: true,
                    reportType: 'offboarding',
                    format: 'pdf',
                    data: processedData,
                    summary: summary,
                    monthlyData: monthlyData,
                    generatedOn: generatedOn,
                    filters: { startDate, endDate, type },
                    reportTitle: 'Resignation & Retirement Tracker Report (HR)',
                    reportSubtitle: 'Comprehensive tracking of employee resignations and retirements with clearance status and timeline analysis'
                });
            }

            return res.json({
                success: true,
                data: processedData,
                summary: summary,
                monthlyData: monthlyData,
                generatedOn: generatedOn,
                reportTitle: 'Resignation & Retirement Tracker Report (HR)'
            });

        } catch (error) {
            console.error('❌ [Offboarding Reports] Error in getOffboardingReports:', error);
            return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
        }
    },

    getOffboardingDashboardStats: async function(req, res) {
        if (!req.session.user || req.session.user.userRole !== 'HR') {
            return res.status(401).json({ success: false, message: 'Unauthorized access' });
        }

        try {
            console.log('🔍 [Offboarding Dashboard] Fetching dashboard statistics...');

            // Get all offboarding requests
            const { data: allRequests, error: requestsError } = await supabase
                .from('offboarding_requests')
                .select(`
                    requestId,
                    offboardingType,
                    status,
                    created_at,
                    last_day
                `);

            if (requestsError) {
                console.error('❌ [Offboarding Dashboard] Error fetching requests:', requestsError);
                throw requestsError;
            }

            console.log(`✅ [Offboarding Dashboard] Found ${allRequests.length} total requests`);

            // Calculate statistics
            const currentDate = new Date();
            const thisMonth = allRequests.filter(r => {
                const reqDate = new Date(r.created_at);
                return reqDate.getMonth() === currentDate.getMonth() && 
                    reqDate.getFullYear() === currentDate.getFullYear();
            });

            // Calculate average processing time for completed requests
            const completedRequests = allRequests.filter(r => r.status === 'Completed');
            let avgProcessingTime = 0;
            if (completedRequests.length > 0) {
                const processingTimes = completedRequests.map(r => {
                    const startDate = new Date(r.created_at);
                    const endDate = new Date(); // Assuming completion is recent
                    return Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
                });
                avgProcessingTime = Math.round(processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length);
            }

            const stats = {
                totalRequests: allRequests.length,
                resignations: allRequests.filter(r => r.offboardingType === 'Resignation').length,
                retirements: allRequests.filter(r => r.offboardingType === 'Retirement').length,
                pendingRequests: allRequests.filter(r => r.status === 'Pending HR').length,
                avgProcessingTime: avgProcessingTime,
                monthlyRequests: thisMonth.length
            };

            console.log('📊 [Offboarding Dashboard] Final stats:', stats);

            return res.json({
                success: true,
                stats: stats
            });

        } catch (error) {
            console.error('❌ [Offboarding Dashboard] Error fetching dashboard stats:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Error fetching dashboard statistics: ' + error.message 
            });
        }
    },

    // Get employees for reports dropdown
    getEmployeesForReports: async (req, res) => {
        try {
            console.log('🔄 [Backend] Fetching employees for dropdown...');
            
            // Alternative approach: Query staffaccounts directly and join with useraccounts
            const { data: employees, error } = await supabase
                .from('staffaccounts')
                .select(`
                    userId,
                    firstName,
                    lastName,
                    departmentId,
                    departments (
                        deptName
                    ),
                    useraccounts!inner (
                        userRole,
                        userEmail
                    )
                `)
                .neq('useraccounts.userRole', 'HR')
                .not('firstName', 'is', null)
                .not('lastName', 'is', null)
                .order('firstName', { ascending: true });
            
            if (error) {
                console.error('❌ [Backend] Error fetching employees:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch employees: ' + error.message
                });
            }
            
            console.log(`📊 [Backend] Found ${employees?.length || 0} employees with staff accounts`);
            
            // Format the data for frontend
            const formattedEmployees = (employees || []).map(emp => ({
                userId: emp.userId,
                firstName: emp.firstName,
                lastName: emp.lastName,
                department: emp.departments?.deptName || 'Unknown',
                email: emp.useraccounts?.userEmail || 'Unknown'
            }));
            
            console.log(`✅ [Backend] Formatted ${formattedEmployees.length} employees`);
            
            // Log some sample data for debugging
            if (formattedEmployees.length > 0) {
                console.log(`📝 [Backend] Sample employee:`, formattedEmployees[0]);
            }
            
            res.json({
                success: true,
                employees: formattedEmployees
            });
            
        } catch (error) {
            console.error('❌ [Backend] Error in getEmployeesForReports:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch employees: ' + error.message
            });
        }
    },

    getDailyAttendanceReport: async (req, res) => {
        try {
            const { attendanceDate } = req.query;
            console.log(`🔄 [Backend] Generating daily attendance report for date: ${attendanceDate}`);
            
            if (!attendanceDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Attendance date is required'
                });
            }

            // Get all staff members
            const { data: allStaff, error: staffError } = await supabase
                .from('staffaccounts')
                .select(`
                    userId,
                    firstName,
                    lastName,
                    departments (
                        deptName
                    ),
                    jobpositions (
                        jobTitle
                    ),
                    useraccounts (
                        userRole
                    )
                `)
                .neq('useraccounts.userRole', 'HR');
            
            if (staffError) {
                console.error('❌ [Backend] Error fetching staff:', staffError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch staff data: ' + staffError.message
                });
            }

            console.log(`👥 [Backend] Found ${allStaff.length} total staff members`);
            
            // Get attendance logs for the specified date
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
                .order('userId', { ascending: true })
                .order('attendanceTime', { ascending: true });
            
            if (attendanceError) {
                console.error('❌ [Backend] Error fetching attendance:', attendanceError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch attendance data: ' + attendanceError.message
                });
            }

            console.log(`📊 [Backend] Found ${attendanceLogs.length} attendance records for ${attendanceDate}`);
            
            // Get leave requests for the same date
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
                .gte('untilDate', attendanceDate);
            
            if (leaveError) {
                console.error('❌ [Backend] Error fetching leave requests:', leaveError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch leave data: ' + leaveError.message
                });
            }

            console.log(`🏖️ [Backend] Found ${leaveRequests.length} approved leave requests for ${attendanceDate}`);
            
            // Process attendance data
            const attendanceMap = {};
            attendanceLogs.forEach(log => {
                if (!attendanceMap[log.userId]) {
                    attendanceMap[log.userId] = [];
                }
                attendanceMap[log.userId].push(log);
            });
            
            // Process leave data
            const leaveMap = {};
            leaveRequests.forEach(leave => {
                leaveMap[leave.userId] = leave;
            });
            
            // Process each employee
            const detailedAttendance = {};
            const departmentBreakdown = {};
            let totalEmployees = 0;
            let present = 0;
            let onLeave = 0;
            let late = 0;
            let earlyOut = 0;
            
            allStaff.forEach(employee => {
                const dept = employee.departments?.deptName || 'Unknown';
                
                // Initialize department breakdown
                if (!departmentBreakdown[dept]) {
                    departmentBreakdown[dept] = {
                        department: dept,
                        totalEmployees: 0,
                        present: 0,
                        late: 0,
                        onLeave: 0,
                        earlyOut: 0
                    };
                }
                
                // Initialize detailed attendance by department
                if (!detailedAttendance[dept]) {
                    detailedAttendance[dept] = [];
                }
                
                departmentBreakdown[dept].totalEmployees++;
                totalEmployees++;
                
                const empAttendance = attendanceMap[employee.userId] || [];
                const empLeave = leaveMap[employee.userId];
                
                let timeIn = null;
                let timeOut = null;
                let status = 'Absent';
                let lateMinutes = 0;
                let earlyOutMinutes = 0;
                let hoursWorked = 'N/A';
                
                // Check if employee is on leave
                if (empLeave) {
                    status = 'On Leave';
                    departmentBreakdown[dept].onLeave++;
                    onLeave++;
                } else if (empAttendance.length > 0) {
                    // Find time in and time out
                    const timeInRecord = empAttendance.find(log => log.attendanceAction === 'Time In');
                    const timeOutRecord = empAttendance.find(log => log.attendanceAction === 'Time Out');
                    
                    if (timeInRecord) {
                        timeIn = timeInRecord.attendanceTime;
                        status = 'Present';
                        
                        // Check if late (assuming 9:00 AM is the standard time)
                        const standardTimeIn = '09:00:00';
                        if (timeIn > standardTimeIn) {
                            status = 'Late';
                            const timeInDate = new Date(`1970-01-01T${timeIn}`);
                            const standardDate = new Date(`1970-01-01T${standardTimeIn}`);
                            lateMinutes = Math.round((timeInDate - standardDate) / 60000);
                            departmentBreakdown[dept].late++;
                            late++;
                        } else {
                            departmentBreakdown[dept].present++;
                            present++;
                        }
                    }
                    
                    if (timeOutRecord) {
                        timeOut = timeOutRecord.attendanceTime;
                        
                        // Check if early out (assuming 6:00 PM is the standard time)
                        const standardTimeOut = '18:00:00';
                        if (timeOut < standardTimeOut) {
                            const timeOutDate = new Date(`1970-01-01T${timeOut}`);
                            const standardDate = new Date(`1970-01-01T${standardTimeOut}`);
                            earlyOutMinutes = Math.round((standardDate - timeOutDate) / 60000);
                            departmentBreakdown[dept].earlyOut++;
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
                
                // Add to detailed attendance
                detailedAttendance[dept].push({
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
            
            const response = {
                success: true,
                reportDate: attendanceDate,
                summary: summary,
                departmentBreakdown: Object.values(departmentBreakdown),
                detailedAttendance: detailedAttendance
            };
            
            console.log(`✅ [Backend] Daily attendance report generated successfully`);
            console.log(`📈 [Backend] Summary: ${present} present, ${onLeave} on leave, ${late} late, ${earlyOut} early out of ${totalEmployees} total`);
            
            res.json(response);
            
        } catch (error) {
            console.error('❌ [Backend] Error generating daily attendance report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate daily attendance report: ' + error.message
            });
        }
    },

    // Enhanced getEmployeeAttendanceReport function for Weekly/Monthly Individual Employee Reports
    getEmployeeAttendanceReport: async (req, res) => {
        try {
            const { employeeId, startDate, endDate, reportType } = req.query;
            console.log(`🔄 [Employee Report] Generating comprehensive employee attendance report for employee ${employeeId} from ${startDate} to ${endDate}, type: ${reportType}`);
            
            if (!employeeId || !startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Employee ID, start date, and end date are required'
                });
            }
            
            // Get employee details with enhanced information
            const { data: employeeData, error: employeeError } = await supabase
                .from('staffaccounts')
                .select(`
                    userId,
                    firstName,
                    lastName,
                    hireDate,
                    departments (
                        deptName
                    ),
                    jobpositions (
                        jobTitle
                    ),
                    useraccounts (
                        userEmail
                    )
                `)
                .eq('userId', employeeId)
                .single();
            
            if (employeeError || !employeeData) {
                console.error('❌ [Employee Report] Error fetching employee:', employeeError);
                return res.status(404).json({
                    success: false,
                    message: 'Employee not found'
                });
            }
            
            console.log(`👤 [Employee Report] Processing report for: ${employeeData.firstName} ${employeeData.lastName}`);
            
            // Get all attendance records for the date range
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
                console.error('❌ [Employee Report] Error fetching attendance records:', attendanceError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch attendance records: ' + attendanceError.message
                });
            }
            
            console.log(`📊 [Employee Report] Found ${attendanceRecords?.length || 0} attendance records`);
            
            // Get leave requests for the date range (both approved and pending)
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
                console.error('❌ [Employee Report] Error fetching leave records:', leaveError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch leave records: ' + leaveError.message
                });
            }
            
            console.log(`🏖️ [Employee Report] Found ${leaveRecords?.length || 0} leave records`);
            
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
                console.error('❌ [Employee Report] Error fetching leave balances:', balanceError);
            }
            
            console.log(`💰 [Employee Report] Found ${leaveBalances?.length || 0} leave balance records`);
            
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
                    approvedBy: 'Manager', // This would come from approval records
                    approvalDate: leave.updatedDate ? new Date(leave.updatedDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    }) : 'N/A',
                    remarks: leave.remarkByManager || 'N/A'
                }));
            
            const pendingLeave = (leaveRecords || [])
                .filter(leave => leave.status === 'Pending')
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
                    userId: employeeData.userId,
                    employeeName: `${employeeData.firstName} ${employeeData.lastName}`,
                    firstName: employeeData.firstName,
                    lastName: employeeData.lastName,
                    position: employeeData.jobpositions?.jobTitle || 'Unknown',
                    department: employeeData.departments?.deptName || 'Unknown',
                    email: employeeData.useraccounts?.userEmail || 'N/A',
                    hireDate: employeeData.hireDate
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
            
            console.log(`✅ [Employee Report] Comprehensive employee attendance report generated for ${employeeData.firstName} ${employeeData.lastName}`);
            console.log(`📈 [Employee Report] Summary: ${daysPresent}/${workingDaysInPeriod} working days present, ${daysOnLeave} days on leave, ${lateArrivals} late arrivals`);
            
            res.json(response);
            
        } catch (error) {
            console.error('❌ [Employee Report] Error generating comprehensive employee attendance report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate employee attendance report: ' + error.message
            });
        }
    },

    getLeaveRequestsReport: async (req, res) => {
        try {
            const { startDate, endDate, reportType } = req.query;
            console.log(`🔄 [Backend] Generating leave requests report from ${startDate} to ${endDate}, type: ${reportType}`);
            
            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Start date and end date are required'
                });
            }
            
            // Get leave requests for the date range with comprehensive data
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
                .order('fromDate', { ascending: false });
            
            if (leaveError) {
                console.error('❌ [Backend] Error fetching leave requests:', leaveError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch leave requests: ' + leaveError.message
                });
            }
            
            console.log(`📊 [Backend] Found ${leaveRequests?.length || 0} leave requests`);
            console.log('🔍 [Debug] Sample leave request data:', JSON.stringify(leaveRequests[0], null, 2));
            
            // Get current leave balances for all employees with leave requests
            const userIds = [...new Set(leaveRequests.map(req => req.userId))];
            
            let leaveBalances = [];
            if (userIds.length > 0) {
                const { data: balances, error: balanceError } = await supabase
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
                    .in('userId', userIds);
                
                if (balanceError) {
                    console.error('❌ [Backend] Error fetching leave balances:', balanceError);
                } else {
                    leaveBalances = balances || [];
                }
            }
            
            console.log(`💰 [Backend] Found ${leaveBalances.length} leave balance records`);
            
            // Get all departments for consistency
            const { data: departments, error: deptError } = await supabase
                .from('departments')
                .select('departmentId, deptName')
                .order('deptName', { ascending: true });
            
            if (deptError) {
                console.error('❌ [Backend] Error fetching departments:', deptError);
            }
            
            // Helper function to calculate leave duration
            const calculateDuration = (fromDate, untilDate) => {
                const start = new Date(fromDate);
                const end = new Date(untilDate);
                return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            };
            
            // Format leave requests with enhanced data
            const formattedLeaveRequests = leaveRequests.map(leave => {
                const duration = calculateDuration(leave.fromDate, leave.untilDate);
                
                return {
                    leaveRequestId: leave.leaveRequestId,
                    userId: leave.userId,
                    firstName: leave.useraccounts?.staffaccounts?.[0]?.firstName || 'Unknown',
                    lastName: leave.useraccounts?.staffaccounts?.[0]?.lastName || 'Unknown',
                    department: leave.useraccounts?.staffaccounts?.[0]?.departments?.deptName || 'Unknown',
                    fromDate: leave.fromDate,
                    untilDate: leave.untilDate,
                    leaveType: leave.leave_types?.typeName || 'Unknown',
                    reason: leave.reason || 'No reason provided',
                    status: leave.status || 'Pending',
                    createdAt: leave.created_at,
                    updatedDate: leave.updatedDate,
                    remarkByManager: leave.remarkByManager || '',
                    duration: duration,
                    // Format dates for display
                    requestDate: leave.created_at ? new Date(leave.created_at).toLocaleDateString() : 'Unknown',
                    approvalDate: leave.updatedDate ? new Date(leave.updatedDate).toLocaleDateString() : 'Pending'
                };
            });
            
            // Format leave balances with user mapping
            const formattedLeaveBalances = leaveBalances.map(balance => ({
                userId: balance.userId,
                firstName: balance.staffaccounts?.firstName || 'Unknown',
                lastName: balance.staffaccounts?.lastName || 'Unknown',
                department: balance.staffaccounts?.departments?.deptName || 'Unknown',
                leaveType: balance.leave_types?.typeName || 'Unknown',
                totalLeaves: balance.totalLeaves || 0,
                usedLeaves: balance.usedLeaves || 0,
                remainingLeaves: balance.remainingLeaves || 0,
                leaveTypeId: balance.leaveTypeId
            }));
            
            // Calculate comprehensive statistics
            const statistics = {
                totalRequests: formattedLeaveRequests.length,
                approvedRequests: formattedLeaveRequests.filter(req => req.status === 'Approved').length,
                pendingRequests: formattedLeaveRequests.filter(req => req.status === 'Pending').length,
                rejectedRequests: formattedLeaveRequests.filter(req => req.status === 'Rejected').length,
                totalDaysRequested: formattedLeaveRequests.reduce((sum, req) => sum + req.duration, 0),
                totalDaysApproved: formattedLeaveRequests
                    .filter(req => req.status === 'Approved')
                    .reduce((sum, req) => sum + req.duration, 0)
            };
            
            // Group requests by department for analysis
            const departmentBreakdown = {};
            const allDepartments = [...new Set([
                ...formattedLeaveRequests.map(req => req.department),
                ...(departments || []).map(dept => dept.deptName)
            ])].sort();
            
            allDepartments.forEach(dept => {
                const deptRequests = formattedLeaveRequests.filter(req => req.department === dept);
                departmentBreakdown[dept] = {
                    department: dept,
                    totalRequests: deptRequests.length,
                    approvedRequests: deptRequests.filter(req => req.status === 'Approved').length,
                    pendingRequests: deptRequests.filter(req => req.status === 'Pending').length,
                    rejectedRequests: deptRequests.filter(req => req.status === 'Rejected').length,
                    totalDaysRequested: deptRequests.reduce((sum, req) => sum + req.duration, 0),
                    totalDaysApproved: deptRequests
                        .filter(req => req.status === 'Approved')
                        .reduce((sum, req) => sum + req.duration, 0),
                    requests: deptRequests
                };
            });
            
            // Group leave types statistics
            const leaveTypeBreakdown = {};
            const allLeaveTypes = [...new Set(formattedLeaveRequests.map(req => req.leaveType))];
            
            allLeaveTypes.forEach(type => {
                const typeRequests = formattedLeaveRequests.filter(req => req.leaveType === type);
                leaveTypeBreakdown[type] = {
                    leaveType: type,
                    totalRequests: typeRequests.length,
                    approvedRequests: typeRequests.filter(req => req.status === 'Approved').length,
                    pendingRequests: typeRequests.filter(req => req.status === 'Pending').length,
                    totalDaysRequested: typeRequests.reduce((sum, req) => sum + req.duration, 0),
                    totalDaysApproved: typeRequests
                        .filter(req => req.status === 'Approved')
                        .reduce((sum, req) => sum + req.duration, 0)
                };
            });
            
            // Build comprehensive response
            const response = {
                success: true,
                reportType: reportType || 'monthly',
                startDate: startDate,
                endDate: endDate,
                generatedAt: new Date().toISOString(),
                
                // Summary statistics
                statistics: statistics,
                
                // Main data
                leaveRequests: formattedLeaveRequests,
                leaveBalances: formattedLeaveBalances,
                
                // Breakdowns for analysis
                departmentBreakdown: Object.values(departmentBreakdown),
                leaveTypeBreakdown: Object.values(leaveTypeBreakdown),
                
                // Additional metadata
                totalDepartments: allDepartments.length,
                totalLeaveTypes: allLeaveTypes.length,
                dateRange: {
                    start: startDate,
                    end: endDate,
                    duration: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1
                }
            };
            
            console.log(`✅ [Backend] Leave requests report generated successfully`);
            console.log(`📈 [Backend] Summary: ${statistics.totalRequests} total requests, ${statistics.approvedRequests} approved, ${statistics.pendingRequests} pending`);
            console.log(`📊 [Backend] Department breakdown: ${Object.keys(departmentBreakdown).length} departments`);
            
            res.json(response);
            
        } catch (error) {
            console.error('❌ [Backend] Error generating leave requests report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate leave requests report: ' + error.message
            });
        }
    },

    // Get all company employees for feedback reports dropdown
    getCompanyWideEmployeesForFeedbackReports: async function(req, res) {
        try {
            console.log('🔄 [HR] Fetching company-wide employees for feedback reports...');
            
            const hrUserId = req.session.user?.userId;
            if (!hrUserId) {
                console.error('❌ HR user not authenticated');
                return res.status(401).json({
                    success: false,
                    message: 'HR user not authenticated'
                });
            }

            console.log('👤 HR User ID:', hrUserId);

            // Get all employees across all departments (excluding HR users)
            const { data: employees, error: employeeError } = await supabase
                .from('staffaccounts')
                .select(`
                    userId,
                    firstName,
                    lastName,
                    departmentId,
                    hireDate,
                    jobpositions!staffaccounts_jobId_fkey(jobTitle),
                    departments!staffaccounts_departmentId_fkey(deptName)
                `)
                .neq('userRole', 'HR') // Exclude HR users
                .order('departments.deptName', { ascending: true })
                .order('firstName', { ascending: true });

            console.log('👥 Employee Query Result:', employees?.length || 0);
            if (employeeError) console.log('❌ Employee Query Error:', employeeError);

            if (employeeError) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to fetch company employees: ' + employeeError.message
                });
            }

            // Check which employees have feedback data for each quarter
            const enrichedEmployees = [];
            
            for (const employee of employees || []) {
                console.log(`🔍 Checking feedback availability for: ${employee.firstName} ${employee.lastName} (ID: ${employee.userId})`);
                
                const feedbackAvailability = await hrController.checkEmployeeFeedbackAvailability(employee.userId);
                
                enrichedEmployees.push({
                    userId: employee.userId,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    fullName: `${employee.firstName} ${employee.lastName}`,
                    jobTitle: employee.jobpositions?.jobTitle || 'Unknown',
                    department: employee.departments?.deptName || 'Unknown',
                    departmentId: employee.departmentId,
                    hireDate: employee.hireDate,
                    feedbackAvailability: feedbackAvailability
                });
            }

            // Group employees by department for better organization
            const departmentStats = {};
            enrichedEmployees.forEach(employee => {
                const deptName = employee.department;
                if (!departmentStats[deptName]) {
                    departmentStats[deptName] = {
                        departmentId: employee.departmentId,
                        employeeCount: 0,
                        employeesWithFeedback: 0
                    };
                }
                departmentStats[deptName].employeeCount++;
                
                // Check if employee has any feedback
                const hasFeedback = Object.values(employee.feedbackAvailability).some(available => available);
                if (hasFeedback) {
                    departmentStats[deptName].employeesWithFeedback++;
                }
            });

            console.log('✅ Enriched employees:', enrichedEmployees.length);
            console.log('📊 Department stats:', departmentStats);

            return res.json({
                success: true,
                employees: enrichedEmployees,
                departmentStats: departmentStats,
                companyStats: {
                    totalEmployees: enrichedEmployees.length,
                    totalDepartments: Object.keys(departmentStats).length,
                    employeesWithFeedback: enrichedEmployees.filter(emp => 
                        Object.values(emp.feedbackAvailability).some(available => available)
                    ).length
                }
            });

        } catch (error) {
            console.error('❌ [HR] Error fetching company-wide employees:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch company employees: ' + error.message
            });
        }
    },

    // Generate quarterly feedback report (same as line manager, no department check)
    generateQuarterlyFeedbackReport: async function(req, res) {
        try {
            const { employeeId: userId } = req.query;
            const { quarter, year = new Date().getFullYear()} = req.query;
            
            console.log(`🎯 [HR] Generating quarterly feedback report for user ${userId}, ${quarter} ${year}`);
            
            // Validation
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: "User ID is required."
                });
            }
            
            if (!quarter || !['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) {
                return res.status(400).json({
                    success: false,
                    message: "Valid quarter (Q1, Q2, Q3, Q4) is required."
                });
            }
            
            const yearNum = parseInt(year);
            if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2030) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid year provided."
                });
            }
            
            // Get employee data (no department verification for HR)
            const { data: employeeData, error: employeeError } = await supabase
                .from('staffaccounts')
                .select(`
                    firstName,
                    lastName,
                    jobId,
                    departmentId,
                    hireDate,
                    jobpositions!inner (jobTitle),
                    departments!inner (deptName),
                    useraccounts!inner (userEmail)
                `)
                .eq('userId', userId)
                .single();
                
            if (employeeError || !employeeData) {
                return res.status(404).json({
                    success: false,
                    message: "Employee not found."
                });
            }
            
            // Get HR user data
            let hrUserData = null;
            if (req.session?.user?.userId) {
                const { data: hrData } = await supabase
                    .from('staffaccounts')
                    .select(`
                        firstName,
                        lastName,
                        jobpositions!inner (jobTitle)
                    `)
                    .eq('userId', req.session.user.userId)
                    .single();
                
                if (hrData) {
                    hrUserData = hrData;
                }
            }
            
            // Get feedback data using the same helper functions from line manager
            const feedbackData = await hrController.getQuarterlyFeedbackData(userId, quarter, yearNum);
            
            if (!feedbackData.success) {
                return res.status(404).json({
                    success: false,
                    message: `No ${quarter} feedback found for ${year}.`
                });
            }
            
            // Get respondent counts
            const respondentCounts = await hrController.getRespondentCounts(userId, yearNum);
            
            // Prepare report data
            const reportData = {
                employee: {
                    ...employeeData,
                    fullName: `${employeeData.firstName} ${employeeData.lastName}`
                },
                hrUser: hrUserData ? {
                    ...hrUserData,
                    fullName: `${hrUserData.firstName} ${hrUserData.lastName}`
                } : null,
                reportingPeriod: {
                    quarter,
                    year: yearNum,
                    startDate: feedbackData.data.startDate,
                    endDate: feedbackData.data.endDate
                },
                objectives: feedbackData.data.objectives,
                hardSkills: feedbackData.data.hardSkills,
                softSkills: feedbackData.data.softSkills,
                summary: feedbackData.data.summary,
                respondentCounts: respondentCounts
            };
            
            return res.json({
                success: true,
                data: reportData,
                filename: `HR_Quarterly_Feedback_Report_${employeeData.firstName}_${employeeData.lastName}_${quarter}_${year}.pdf`
            });
            
        } catch (error) {
            console.error('❌ [HR] Error in generateQuarterlyFeedbackReport:', error);
            return res.status(500).json({
                success: false,
                message: "An error occurred while generating the report.",
                error: error.message
            });
        }
    },

    // Mid-Year Report (same as line manager, no department check)
    getMidYearFeedbackReport: async function(req, res) {
        try {
            const { employeeId, year = new Date().getFullYear() } = req.query;
            
            console.log(`🔄 [HR] Generating Mid-Year report for employee ${employeeId}, year ${year}`);
            
            if (!employeeId) {
                return res.status(400).json({
                    success: false,
                    message: "Employee ID is required."
                });
            }
            
            // Get employee basic info (no department verification)
            const employeeInfo = await hrController.getEmployeeBasicInfo(employeeId);
            if (!employeeInfo.success) {
                return res.status(404).json({
                    success: false,
                    message: "Employee not found."
                });
            }
            
            // Get Q1 and Q2 feedback data
            const q1Data = await hrController.getQuarterlyFeedbackData(employeeId, 'Q1', year);
            const q2Data = await hrController.getQuarterlyFeedbackData(employeeId, 'Q2', year);
            
            console.log(`Q1 Data Success: ${q1Data.success}, Q2 Data Success: ${q2Data.success}`);
            
            if (!q1Data.success && !q2Data.success) {
                return res.status(404).json({
                    success: false,
                    message: `No Q1 or Q2 feedback data found for ${year}.`
                });
            }
            
            // Use the same combineMidYearData function from line manager
            const combinedData = hrController.combineMidYearData(q1Data, q2Data, employeeInfo.data, year);
            
            return res.json({
                success: true,
                data: combinedData
            });
            
        } catch (error) {
            console.error('❌ [HR] Error in getMidYearFeedbackReport:', error);
            return res.status(500).json({
                success: false,
                message: "An error occurred while generating the mid-year report.",
                error: error.message
            });
        }
    },

    // Final-Year Report (same as line manager, no department check)
    getFinalYearFeedbackReport: async function(req, res) {
        try {
            const { employeeId, year = new Date().getFullYear() } = req.query;
            
            console.log(`🔄 [HR] Generating Final-Year report for employee ${employeeId}, year ${year}`);
            
            if (!employeeId) {
                return res.status(400).json({
                    success: false,
                    message: "Employee ID is required."
                });
            }
            
            // Get employee basic info (no department verification)
            const employeeInfo = await hrController.getEmployeeBasicInfo(employeeId);
            if (!employeeInfo.success) {
                return res.status(404).json({
                    success: false,
                    message: "Employee not found."
                });
            }
            
            // Get Q3 and Q4 feedback data
            const q3Data = await hrController.getQuarterlyFeedbackData(employeeId, 'Q3', year);
            const q4Data = await hrController.getQuarterlyFeedbackData(employeeId, 'Q4', year);
            
            console.log(`Q3 Data Success: ${q3Data.success}, Q4 Data Success: ${q4Data.success}`);
            
            if (!q3Data.success && !q4Data.success) {
                return res.status(404).json({
                    success: false,
                    message: `No Q3 or Q4 feedback data found for ${year}.`
                });
            }
            
            // Use the same combineFinalYearData function from line manager
            const combinedData = hrController.combineFinalYearData(q3Data, q4Data, employeeInfo.data, year);
            
            return res.json({
                success: true,
                data: combinedData
            });
            
        } catch (error) {
            console.error('❌ [HR] Error in getFinalYearFeedbackReport:', error);
            return res.status(500).json({
                success: false,
                message: "An error occurred while generating the final-year report.",
                error: error.message
            });
        }
    },

    // Comparison Report (same as line manager, no department check)
    getComparisonFeedbackReport: async function(req, res) {
        try {
            const { employeeId, year = new Date().getFullYear() } = req.query;
            
            console.log(`🔄 [HR] Generating Comparison report for employee ${employeeId}, year ${year}`);
            
            if (!employeeId) {
                return res.status(400).json({
                    success: false,
                    message: "Employee ID is required."
                });
            }
            
            // Get employee basic info (no department verification)
            const employeeInfo = await hrController.getEmployeeBasicInfo(employeeId);
            if (!employeeInfo.success) {
                return res.status(404).json({
                    success: false,
                    message: "Employee not found."
                });
            }
            
            // Fetch all quarterly data in parallel
            console.log('🚀 Fetching all quarterly data in parallel...');
            
            const [q1Data, q2Data, q3Data, q4Data] = await Promise.all([
                hrController.getQuarterlyFeedbackData(employeeId, 'Q1', year),
                hrController.getQuarterlyFeedbackData(employeeId, 'Q2', year),
                hrController.getQuarterlyFeedbackData(employeeId, 'Q3', year),
                hrController.getQuarterlyFeedbackData(employeeId, 'Q4', year)
            ]);
            
            console.log(`✅ Parallel fetch completed - Q1: ${q1Data.success}, Q2: ${q2Data.success}, Q3: ${q3Data.success}, Q4: ${q4Data.success}`);
            
            // Early return if no data at all
            const hasAnyData = q1Data.success || q2Data.success || q3Data.success || q4Data.success;
            if (!hasAnyData) {
                return res.status(404).json({
                    success: false,
                    message: `No feedback data found for comparison in ${year}.`
                });
            }
            
            // Process comparison data
            const [midYearData, finalYearData] = await Promise.all([
                new Promise((resolve) => {
                    try {
                        const result = hrController.combineMidYearData(q1Data, q2Data, employeeInfo.data, year);
                        resolve(result);
                    } catch (error) {
                        console.error('Error combining mid-year data:', error);
                        resolve(null);
                    }
                }),
                new Promise((resolve) => {
                    try {
                        const result = hrController.combineFinalYearData(q3Data, q4Data, employeeInfo.data, year);
                        resolve(result);
                    } catch (error) {
                        console.error('Error combining final-year data:', error);
                        resolve(null);
                    }
                })
            ]);
            
            // Check if we have processable data
            const hasMidYear = midYearData && (q1Data.success || q2Data.success);
            const hasFinalYear = finalYearData && (q3Data.success || q4Data.success);
            
            if (!hasMidYear && !hasFinalYear) {
                return res.status(404).json({
                    success: false,
                    message: `No processable feedback data found for comparison in ${year}.`
                });
            }
            
            // Generate comparison data
            const comparisonData = hrController.generateComparisonData(midYearData, finalYearData, employeeInfo.data, year);
            
            console.log('✅ [HR] Comparison report completed successfully');
            
            return res.json({
                success: true,
                data: comparisonData
            });
            
        } catch (error) {
            console.error('❌ [HR] Error in getComparisonFeedbackReport:', error);
            return res.status(500).json({
                success: false,
                message: "An error occurred while generating the comparison report.",
                error: error.message
            });
        }
    },

};


module.exports = hrController;
