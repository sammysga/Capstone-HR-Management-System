const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { getISOWeek } = require('date-fns');
const { sendCustomEmail, sendBatchStatusEmails, getEmailTemplateData } = require('../utils/emailService');
const PDFDocument = require('pdfkit');

// Store for tracking email batch processes
const emailBatches = new Map();

function calculateDateRange(timePeriod) {
    const now = new Date();
    let startDate, endDate;

    switch (timePeriod) {
        case 'thisYear':
            startDate = new Date(now.getFullYear(), 0, 1); // January 1st of current year
            endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59); // December 31st of current year
            break;
            
        case 'lastYear':
            startDate = new Date(now.getFullYear() - 1, 0, 1); // January 1st of last year
            endDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59); // December 31st of last year
            break;
            
        case 'last6Months':
            endDate = new Date(now);
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 6);
            break;
            
        case 'last3Months':
            endDate = new Date(now);
            startDate = new Date(now);
            startDate.setMonth(startDate.getMonth() - 3);
            break;
            
        case 'thisMonth':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
            break;
            
        case 'lastMonth':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            break;
            
        default: // Default to this year
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    }

    return { startDate, endDate };
}

// 2. Performance Score Calculator using your actual feedback tables
async function getEmployeePerformanceScores(userId, trainingStartDate, trainingEndDate) {
    try {
        // Since you don't have a performance_evaluations table, 
        // we'll use feedback answers from your quarterly feedback system
        
        const trainingStart = new Date(trainingStartDate);
        const trainingEnd = new Date(trainingEndDate);
        
        // Before period: 6 months before training start
        const beforePeriodStart = new Date(trainingStart);
        beforePeriodStart.setMonth(beforePeriodStart.getMonth() - 6);
        
        // After period: 6 months after training end
        const afterPeriodStart = new Date(trainingEnd);
        const afterPeriodEnd = new Date(trainingEnd);
        afterPeriodEnd.setMonth(afterPeriodEnd.getMonth() + 6);

        // Get feedback data before training
        const { data: beforeFeedback } = await supabase
            .from('feedbacks_answers')
            .select(`
                feedbackId_answerId,
                reviewDate,
                feedbacks_answers-skills!inner (
                    skillsQuantInput
                ),
                feedbacks_answers-objectives!inner (
                    objectiveQuantInput
                )
            `)
            .eq('userId', userId)
            .gte('reviewDate', beforePeriodStart.toISOString().split('T')[0])
            .lt('reviewDate', trainingStart.toISOString().split('T')[0])
            .order('reviewDate', { ascending: false });

        // Get feedback data after training
        const { data: afterFeedback } = await supabase
            .from('feedbacks_answers')
            .select(`
                feedbackId_answerId,
                reviewDate,
                feedbacks_answers-skills!inner (
                    skillsQuantInput
                ),
                feedbacks_answers-objectives!inner (
                    objectiveQuantInput
                )
            `)
            .eq('userId', userId)
            .gt('reviewDate', trainingEnd.toISOString().split('T')[0])
            .lte('reviewDate', afterPeriodEnd.toISOString().split('T')[0])
            .order('reviewDate', { ascending: false });

        // Calculate average scores from skills and objectives
        const calculateAverageScore = (feedbackData) => {
            if (!feedbackData || feedbackData.length === 0) return null;
            
            let totalScore = 0;
            let scoreCount = 0;
            
            feedbackData.forEach(feedback => {
                // Add skills scores
                if (feedback['feedbacks_answers-skills']) {
                    feedback['feedbacks_answers-skills'].forEach(skill => {
                        if (skill.skillsQuantInput) {
                            totalScore += skill.skillsQuantInput;
                            scoreCount++;
                        }
                    });
                }
                
                // Add objectives scores
                if (feedback['feedbacks_answers-objectives']) {
                    feedback['feedbacks_answers-objectives'].forEach(objective => {
                        if (objective.objectiveQuantInput) {
                            totalScore += objective.objectiveQuantInput;
                            scoreCount++;
                        }
                    });
                }
            });
            
            return scoreCount > 0 ? totalScore / scoreCount : null;
        };

        const beforeScore = calculateAverageScore(beforeFeedback);
        const afterScore = calculateAverageScore(afterFeedback);

        return {
            beforeScore: beforeScore ? parseFloat(beforeScore.toFixed(2)) : null,
            afterScore: afterScore ? parseFloat(afterScore.toFixed(2)) : null,
            beforeCount: beforeFeedback?.length || 0,
            afterCount: afterFeedback?.length || 0
        };

    } catch (error) {
        console.error('Error getting performance scores:', error);
        return {
            beforeScore: null,
            afterScore: null,
            beforeCount: 0,
            afterCount: 0
        };
    }
}

// 3. Alternative simpler performance calculation using IDP data
async function getEmployeePerformanceScoresSimple(userId, trainingStartDate, trainingEndDate) {
    try {
        const trainingStart = new Date(trainingStartDate);
        const trainingEnd = new Date(trainingEndDate);
        
        // Get midyear IDP before training
        const { data: beforeIdp } = await supabase
            .from('midyearidps')
            .select('year, created_at')
            .eq('userId', userId)
            .lt('created_at', trainingStart.toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        // Get finalyear IDP after training  
        const { data: afterIdp } = await supabase
            .from('finalyearidps')
            .select('year, created_at')
            .eq('userId', userId)
            .gt('created_at', trainingEnd.toISOString())
            .order('created_at', { ascending: false })
            .limit(1);

        // For demo purposes, generate mock improvement scores
        // In production, you'd calculate actual performance metrics
        const beforeScore = beforeIdp?.length > 0 ? 3.5 : null;
        const afterScore = afterIdp?.length > 0 ? 4.0 : null;

        return {
            beforeScore,
            afterScore,
            beforeCount: beforeIdp?.length || 0,
            afterCount: afterIdp?.length || 0
        };

    } catch (error) {
        console.error('Error getting simple performance scores:', error);
        return {
            beforeScore: null,
            afterScore: null,
            beforeCount: 0,
            afterCount: 0
        };
    }
}

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
function calculateProgressionInsights(allFeedbackItems) {
    const insights = {
        improved: [],
        maintained: [],
        declined: [],
        summary: {
            totalItems: allFeedbackItems.length,
            improvedCount: 0,
            maintainedCount: 0,
            declinedCount: 0
        }
    };
    
    allFeedbackItems.forEach(item => {
        const q1q2Average = item.quarterRatings.Q1 && item.quarterRatings.Q2 
            ? (item.quarterRatings.Q1 + item.quarterRatings.Q2) / 2 
            : null;
        const q3q4Average = item.quarterRatings.Q3 && item.quarterRatings.Q4 
            ? (item.quarterRatings.Q3 + item.quarterRatings.Q4) / 2 
            : null;
            
        if (q1q2Average && q3q4Average) {
            const difference = q3q4Average - q1q2Average;
            
            if (difference > 0.2) {
                insights.improved.push({ ...item, improvement: difference });
                insights.summary.improvedCount++;
            } else if (difference < -0.2) {
                insights.declined.push({ ...item, decline: Math.abs(difference) });
                insights.summary.declinedCount++;
            } else {
                insights.maintained.push({ ...item, stability: difference });
                insights.summary.maintainedCount++;
            }
        }
    });
    
    return insights;
}


// Helper function to fetch applicant data for emails
async function fetchApplicantDataForEmails(passedUserIds, failedUserIds) {
    const allUserIds = [...passedUserIds, ...failedUserIds];
    
    if (allUserIds.length === 0) {
        return { passedApplicants: [], failedApplicants: [] };
    }
    
    // Fetch applicant data with emails
    const { data: applicantData, error: applicantError } = await supabase
        .from('applicantaccounts')
        .select(`
            userId,
            firstName,
            lastName,
            jobId,
            useraccounts!inner(userEmail)
        `)
        .in('userId', allUserIds);
        
    if (applicantError) {
        throw new Error('Error fetching applicant data: ' + applicantError.message);
    }
    
    // Fetch job titles
    const jobIds = [...new Set(applicantData.map(a => a.jobId))];
    let jobTitles = {};
    
    if (jobIds.length > 0) {
        const { data: jobData, error: jobError } = await supabase
            .from('job_positions')
            .select('jobId, jobTitle')
            .in('jobId', jobIds);
            
        if (!jobError && jobData) {
            jobTitles = jobData.reduce((acc, job) => {
                acc[job.jobId] = job.jobTitle;
                return acc;
            }, {});
        }
    }
    
    // Separate passed and failed applicants
    const passedApplicants = applicantData
        .filter(a => passedUserIds.includes(a.userId))
        .map(applicant => ({
            userId: applicant.userId,
            name: `${applicant.firstName} ${applicant.lastName}`,
            email: applicant.useraccounts.userEmail,
            jobTitle: jobTitles[applicant.jobId] || 'Position'
        }));
        
    const failedApplicants = applicantData
        .filter(a => failedUserIds.includes(a.userId))
        .map(applicant => ({
            userId: applicant.userId,
            name: `${applicant.firstName} ${applicant.lastName}`,
            email: applicant.useraccounts.userEmail,
            jobTitle: jobTitles[applicant.jobId] || 'Position'
        }));
    
    return { passedApplicants, failedApplicants };
}

// Process email batch in background
async function processEmailBatch(batchId, applicants, subject, template) {
    const batch = emailBatches.get(batchId);
    
    try {
        for (let i = 0; i < applicants.length; i++) {
            const applicant = applicants[i];
            
            try {
                const result = await sendCustomEmail(
                    applicant.email,
                    subject,
                    template,
                    applicant.name,
                    applicant.jobTitle
                );
                
                if (result.success) {
                    batch.sent++;
                    console.log(`✅ [Batch ${batchId}] Email sent to: ${applicant.email}`);
                } else {
                    batch.failed++;
                    batch.errors.push(`${applicant.name} (${applicant.email}): ${result.error}`);
                    console.error(`❌ [Batch ${batchId}] Failed to send email to: ${applicant.email}`);
                }
                
                // Small delay between emails
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                batch.failed++;
                batch.errors.push(`${applicant.name} (${applicant.email}): ${error.message}`);
                console.error(`❌ [Batch ${batchId}] Error sending to ${applicant.email}:`, error);
            }
        }
        
        batch.status = 'completed';
        batch.endTime = new Date();
        
        console.log(`✅ [Batch ${batchId}] Completed: ${batch.sent} sent, ${batch.failed} failed`);
        
        // Clean up old batches after 1 hour
        setTimeout(() => {
            emailBatches.delete(batchId);
        }, 3600000);
        
    } catch (error) {
        batch.status = 'error';
        batch.error = error.message;
        console.error(`❌ [Batch ${batchId}] Batch processing error:`, error);
    }
}

// Send automated P1 emails
async function sendAutomatedP1Emails(passedApplicants, failedApplicants, emailData) {
    const results = {
        success: true,
        passed: { sent: 0, failed: 0, errors: [] },
        failed: { sent: 0, failed: 0, errors: [] }
    };
    
    try {
        // Send emails to passed applicants
        if (passedApplicants.length > 0 && emailData.passedSubject && emailData.passedTemplate) {
            for (const applicant of passedApplicants) {
                try {
                    const result = await sendCustomEmail(
                        applicant.email,
                        emailData.passedSubject,
                        emailData.passedTemplate,
                        applicant.name,
                        applicant.jobTitle
                    );
                    
                    if (result.success) {
                        results.passed.sent++;
                    } else {
                        results.passed.failed++;
                        results.passed.errors.push(`${applicant.name}: ${result.error}`);
                    }
                } catch (error) {
                    results.passed.failed++;
                    results.passed.errors.push(`${applicant.name}: ${error.message}`);
                }
                
                // Delay between emails
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Send emails to failed applicants
        if (failedApplicants.length > 0 && emailData.failedSubject && emailData.failedTemplate) {
            for (const applicant of failedApplicants) {
                try {
                    const result = await sendCustomEmail(
                        applicant.email,
                        emailData.failedSubject,
                        emailData.failedTemplate,
                        applicant.name,
                        applicant.jobTitle
                    );
                    
                    if (result.success) {
                        results.failed.sent++;
                    } else {
                        results.failed.failed++;
                        results.failed.errors.push(`${applicant.name}: ${result.error}`);
                    }
                } catch (error) {
                    results.failed.failed++;
                    results.failed.errors.push(`${applicant.name}: ${error.message}`);
                }
                
                // Delay between emails
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Determine overall success
        const totalErrors = results.passed.failed + results.failed.failed;
        results.success = totalErrors === 0;
        
        return results;
        
    } catch (error) {
        console.error('❌ Error in automated P1 email sending:', error);
        results.success = false;
        results.error = error.message;
        return results;
    }
}

// Send automated P3 emails
async function sendAutomatedP3Emails(passedApplicants, failedApplicants, emailData) {
    // Similar implementation as P1 but with P3-specific logic
    return await sendAutomatedP1Emails(passedApplicants, failedApplicants, emailData);
}

// Update P1 statuses after emails
async function updateP1StatusesAfterEmails(passedUserIds, failedUserIds) {
    const updatePromises = [];
    
    // Update passed applicants
    for (const userId of passedUserIds) {
        updatePromises.push(
            supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - PASSED' })
                .eq('userId', userId)
        );
        
        // Add chatbot message
        updatePromises.push(
            supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify({ text: "Congratulations! You have successfully passed the initial screening process." }),
                    sender: 'bot',
                    timestamp: new Date().toISOString(),
                    applicantStage: 'P1 - PASSED'
                }])
        );
    }
    
    // Update failed applicants
    for (const userId of failedUserIds) {
        updatePromises.push(
            supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P1 - FAILED' })
                .eq('userId', userId)
        );
        
        // Add chatbot message
        updatePromises.push(
            supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify({ text: "Thank you for your interest. We regret to inform you that you have not been selected for this position." }),
                    sender: 'bot',
                    timestamp: new Date().toISOString(),
                    applicantStage: 'P1 - FAILED'
                }])
        );
    }
    
    await Promise.all(updatePromises);
}

// Update P3 statuses after emails
async function updateP3StatusesAfterEmails(passedUserIds, failedUserIds) {
    const updatePromises = [];
    
    // Update passed applicants
    for (const userId of passedUserIds) {
        updatePromises.push(
            supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - PASSED' })
                .eq('userId', userId)
        );
        
        // Add chatbot message
        updatePromises.push(
            supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify({ text: "Congratulations! You have successfully passed the final interview stage." }),
                    sender: 'bot',
                    timestamp: new Date().toISOString(),
                    applicantStage: 'P3 - PASSED'
                }])
        );
    }
    
    // Update failed applicants
    for (const userId of failedUserIds) {
        updatePromises.push(
            supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - FAILED' })
                .eq('userId', userId)
        );
        
        // Add chatbot message
        updatePromises.push(
            supabase
                .from('chatbot_history')
                .insert([{
                    userId,
                    message: JSON.stringify({ text: "Thank you for participating in our interview process. We regret to inform you that we will not be proceeding with your application." }),
                    sender: 'bot',
                    timestamp: new Date().toISOString(),
                    applicantStage: 'P3 - FAILED'
                }])
        );
    }
    
    await Promise.all(updatePromises);
}

// Helper function to combine Q1 and Q2 data
function combineMidYearData(q1Data, q2Data, employee, year) {
    console.log('🔄 Combining Mid-Year data...');
    
    const hasQ1 = q1Data.success && q1Data.data;
    const hasQ2 = q2Data.success && q2Data.data;
    
    // Combine objectives
    const combinedObjectives = [];
    const objectivesMap = new Map();
    
    // Process Q1 objectives
    if (hasQ1 && q1Data.data.objectives) {
        q1Data.data.objectives.forEach(obj => {
            objectivesMap.set(obj.objectiveId || obj.objective, {
                ...obj,
                q1Rating: obj.averageRating,
                q2Rating: null,
                combinedRating: obj.averageRating
            });
        });
    }
    
    // Process Q2 objectives and combine
    if (hasQ2 && q2Data.data.objectives) {
        q2Data.data.objectives.forEach(obj => {
            const key = obj.objectiveId || obj.objective;
            if (objectivesMap.has(key)) {
                const existing = objectivesMap.get(key);
                existing.q2Rating = obj.averageRating;
                existing.combinedRating = ((existing.q1Rating || 0) + (obj.averageRating || 0)) / 2;
                existing.averageRating = existing.combinedRating.toFixed(2);
            } else {
                objectivesMap.set(key, {
                    ...obj,
                    q1Rating: null,
                    q2Rating: obj.averageRating,
                    combinedRating: obj.averageRating,
                    averageRating: obj.averageRating
                });
            }
        });
    }
    
    combinedObjectives.push(...objectivesMap.values());
    
    // Combine skills (similar logic)
    const combinedHardSkills = combineSkillsData(
        hasQ1 ? q1Data.data.hardSkills : [],
        hasQ2 ? q2Data.data.hardSkills : []
    );
    
    const combinedSoftSkills = combineSkillsData(
        hasQ1 ? q1Data.data.softSkills : [],
        hasQ2 ? q2Data.data.softSkills : []
    );
    
    // Calculate combined summary
    const summary = calculateCombinedSummary(combinedObjectives, combinedHardSkills, combinedSoftSkills);
    
    return {
        employee: employee,
        year: year,
        reportType: 'midyear',
        period: 'Q1 + Q2 (Mid-Year)',
        quarters: ['Q1', 'Q2'],
        hasQ1: hasQ1,
        hasQ2: hasQ2,
        objectives: combinedObjectives,
        hardSkills: combinedHardSkills,
        softSkills: combinedSoftSkills,
        summary: summary,
        q1Summary: hasQ1 ? q1Data.data.summary : null,
        q2Summary: hasQ2 ? q2Data.data.summary : null
    };
}

// Helper function to combine skills data
function combineSkillsData(q1Skills, q2Skills) {
    const skillsMap = new Map();
    
    // Process Q1 skills
    q1Skills.forEach(skill => {
        skillsMap.set(skill.skillName, {
            ...skill,
            q1Rating: skill.averageRating,
            q2Rating: null,
            combinedRating: skill.averageRating
        });
    });
    
    // Process Q2 skills and combine
    q2Skills.forEach(skill => {
        if (skillsMap.has(skill.skillName)) {
            const existing = skillsMap.get(skill.skillName);
            existing.q2Rating = skill.averageRating;
            existing.combinedRating = ((existing.q1Rating || 0) + (skill.averageRating || 0)) / 2;
            existing.averageRating = existing.combinedRating.toFixed(2);
        } else {
            skillsMap.set(skill.skillName, {
                ...skill,
                q1Rating: null,
                q2Rating: skill.averageRating,
                combinedRating: skill.averageRating,
                averageRating: skill.averageRating
            });
        }
    });
    
    return Array.from(skillsMap.values());
}

// Helper function to calculate combined summary
function calculateCombinedSummary(objectives, hardSkills, softSkills) {
    const objectivesCount = objectives.length;
    const averageObjectiveRating = objectivesCount > 0 
        ? objectives.reduce((sum, obj) => sum + parseFloat(obj.averageRating || 0), 0) / objectivesCount 
        : 0;

    const hardSkillsCount = hardSkills.length;
    const averageHardSkillRating = hardSkillsCount > 0 
        ? hardSkills.reduce((sum, skill) => sum + parseFloat(skill.averageRating || 0), 0) / hardSkillsCount 
        : 0;
    
    const softSkillsCount = softSkills.length;
    const averageSoftSkillRating = softSkillsCount > 0 
        ? softSkills.reduce((sum, skill) => sum + parseFloat(skill.averageRating || 0), 0) / softSkillsCount 
        : 0;
    
    // Calculate overall performance score
    let overallPerformanceScore = 0;
    let totalComponents = 0;
    
    if (objectivesCount > 0) {
        overallPerformanceScore += averageObjectiveRating * 0.5;
        totalComponents += 0.5;
    }
    
    if (hardSkillsCount > 0) {
        overallPerformanceScore += averageHardSkillRating * 0.3;
        totalComponents += 0.3;
    }
    
    if (softSkillsCount > 0) {
        overallPerformanceScore += averageSoftSkillRating * 0.2;
        totalComponents += 0.2;
    }
    
    if (totalComponents > 0) {
        overallPerformanceScore = overallPerformanceScore / totalComponents;
    }
    
    return {
        objectivesCount,
        averageObjectiveRating: parseFloat(averageObjectiveRating.toFixed(2)),
        hardSkillsCount,
        averageHardSkillRating: parseFloat(averageHardSkillRating.toFixed(2)),
        softSkillsCount,
        averageSoftSkillRating: parseFloat(averageSoftSkillRating.toFixed(2)),
        overallPerformanceScore: parseFloat(overallPerformanceScore.toFixed(2))
    };
}

// Helper function to combine Q3 and Q4 data
function combineFinalYearData(q3Data, q4Data, employee, year) {
    console.log('🔄 Combining Final-Year data...');
    
    const hasQ3 = q3Data.success && q3Data.data;
    const hasQ4 = q4Data.success && q4Data.data;
    
    // Combine objectives
    const combinedObjectives = [];
    const objectivesMap = new Map();
    
    // Process Q3 objectives
    if (hasQ3 && q3Data.data.objectives) {
        q3Data.data.objectives.forEach(obj => {
            objectivesMap.set(obj.objectiveId || obj.objective, {
                ...obj,
                q3Rating: obj.averageRating,
                q4Rating: null,
                combinedRating: obj.averageRating
            });
        });
    }
    
    // Process Q4 objectives and combine
    if (hasQ4 && q4Data.data.objectives) {
        q4Data.data.objectives.forEach(obj => {
            const key = obj.objectiveId || obj.objective;
            if (objectivesMap.has(key)) {
                const existing = objectivesMap.get(key);
                existing.q4Rating = obj.averageRating;
                existing.combinedRating = ((existing.q3Rating || 0) + (obj.averageRating || 0)) / 2;
                existing.averageRating = existing.combinedRating.toFixed(2);
            } else {
                objectivesMap.set(key, {
                    ...obj,
                    q3Rating: null,
                    q4Rating: obj.averageRating,
                    combinedRating: obj.averageRating,
                    averageRating: obj.averageRating
                });
            }
        });
    }
    
    combinedObjectives.push(...objectivesMap.values());
    
    // Combine skills
    const combinedHardSkills = combineFinalYearSkillsData(
        hasQ3 ? q3Data.data.hardSkills : [],
        hasQ4 ? q4Data.data.hardSkills : []
    );
    
    const combinedSoftSkills = combineFinalYearSkillsData(
        hasQ3 ? q3Data.data.softSkills : [],
        hasQ4 ? q4Data.data.softSkills : []
    );
    
    // Calculate combined summary
    const summary = calculateCombinedSummary(combinedObjectives, combinedHardSkills, combinedSoftSkills);
    
    return {
        employee: employee,
        year: year,
        reportType: 'finalyear',
        period: 'Q3 + Q4 (Final-Year)',
        quarters: ['Q3', 'Q4'],
        hasQ3: hasQ3,
        hasQ4: hasQ4,
        objectives: combinedObjectives,
        hardSkills: combinedHardSkills,
        softSkills: combinedSoftSkills,
        summary: summary,
        q3Summary: hasQ3 ? q3Data.data.summary : null,
        q4Summary: hasQ4 ? q4Data.data.summary : null
    };
}

// Helper function to combine skills data for final year
function combineFinalYearSkillsData(q3Skills, q4Skills) {
    const skillsMap = new Map();
    
    // Process Q3 skills
    q3Skills.forEach(skill => {
        skillsMap.set(skill.skillName, {
            ...skill,
            q3Rating: skill.averageRating,
            q4Rating: null,
            combinedRating: skill.averageRating
        });
    });
    
    // Process Q4 skills and combine
    q4Skills.forEach(skill => {
        if (skillsMap.has(skill.skillName)) {
            const existing = skillsMap.get(skill.skillName);
            existing.q4Rating = skill.averageRating;
            existing.combinedRating = ((existing.q3Rating || 0) + (skill.averageRating || 0)) / 2;
            existing.averageRating = existing.combinedRating.toFixed(2);
        } else {
            skillsMap.set(skill.skillName, {
                ...skill,
                q3Rating: null,
                q4Rating: skill.averageRating,
                combinedRating: skill.averageRating,
                averageRating: skill.averageRating
            });
        }
    });
    
    return Array.from(skillsMap.values());
}

// Helper function to generate comparison data
function generateComparisonData(midYearData, finalYearData, employee, year) {
    console.log('🔄 Generating comparison data...');
    
    return {
        employee: employee,
        year: year,
        reportType: 'comparison',
        period: 'Mid-Year vs Final-Year Comparison',
        midYearData: midYearData,
        finalYearData: finalYearData,
        midYearSummary: midYearData.summary,
        finalYearSummary: finalYearData.summary,
        
        // Combined view for tables (showing both periods)
        objectives: combineObjectivesForComparison(midYearData.objectives, finalYearData.objectives),
        hardSkills: combineSkillsForComparison(midYearData.hardSkills, finalYearData.hardSkills),
        softSkills: combineSkillsForComparison(midYearData.softSkills, finalYearData.softSkills),
        
        // Performance trends
        trends: calculatePerformanceTrends(midYearData.summary, finalYearData.summary)
    };
}

// Helper function to combine objectives for comparison
function combineObjectivesForComparison(midYearObjectives, finalYearObjectives) {
    const objectivesMap = new Map();
    
    // Add mid-year objectives
    midYearObjectives.forEach(obj => {
        objectivesMap.set(obj.objective, {
            ...obj,
            midYearRating: obj.averageRating,
            finalYearRating: null
        });
    });
    
    // Add final-year objectives
    finalYearObjectives.forEach(obj => {
        if (objectivesMap.has(obj.objective)) {
            objectivesMap.get(obj.objective).finalYearRating = obj.averageRating;
        } else {
            objectivesMap.set(obj.objective, {
                ...obj,
                midYearRating: null,
                finalYearRating: obj.averageRating
            });
        }
    });
    
    return Array.from(objectivesMap.values());
}

// Helper function to combine skills for comparison
function combineSkillsForComparison(midYearSkills, finalYearSkills) {
    const skillsMap = new Map();
    
    // Add mid-year skills
    midYearSkills.forEach(skill => {
        skillsMap.set(skill.skillName, {
            ...skill,
            midYearRating: skill.averageRating,
            finalYearRating: null
        });
    });
    
    // Add final-year skills
    finalYearSkills.forEach(skill => {
        if (skillsMap.has(skill.skillName)) {
            skillsMap.get(skill.skillName).finalYearRating = skill.averageRating;
        } else {
            skillsMap.set(skill.skillName, {
                ...skill,
                midYearRating: null,
                finalYearRating: skill.averageRating
            });
        }
    });
    
    return Array.from(skillsMap.values());
}

// Helper function to calculate performance trends
function calculatePerformanceTrends(midYearSummary, finalYearSummary) {
    const objectivesTrend = (finalYearSummary.averageObjectiveRating || 0) - (midYearSummary.averageObjectiveRating || 0);
    const hardSkillsTrend = (finalYearSummary.averageHardSkillRating || 0) - (midYearSummary.averageHardSkillRating || 0);
    const softSkillsTrend = (finalYearSummary.averageSoftSkillRating || 0) - (midYearSummary.averageSoftSkillRating || 0);
    const overallTrend = (finalYearSummary.overallPerformanceScore || 0) - (midYearSummary.overallPerformanceScore || 0);
    
    return {
        objectivesTrend: parseFloat(objectivesTrend.toFixed(2)),
        hardSkillsTrend: parseFloat(hardSkillsTrend.toFixed(2)),
        softSkillsTrend: parseFloat(softSkillsTrend.toFixed(2)),
        overallTrend: parseFloat(overallTrend.toFixed(2))
    };
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
        
        const currentUserId = req.session?.user?.userId;
        
        if (!currentUserId) {
            return res.status(401).send('Unauthorized - Please log in');
        }

        // ========================================
        // STEP 1: GET LINE MANAGER'S DEPARTMENT
        // ========================================
        console.log('🔍 Getting line manager department info...');
        
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

        if (currentManagerError || !currentManagerInfo) {
            console.error('❌ Error fetching current line manager info:', currentManagerError);
            return res.status(500).send('Error: Unable to determine your department');
        }

        const managerDepartmentId = currentManagerInfo?.jobpositions?.departmentId;
        const managerDepartmentName = currentManagerInfo?.jobpositions?.departments?.deptName;
        
        console.log('🏢 Line manager department:', {
            id: managerDepartmentId,
            name: managerDepartmentName
        });

        if (!managerDepartmentId) {
            return res.status(400).send('Error: Your position is not assigned to a department');
        }

        // ========================================
        // STEP 2: GET ALL JOB IDS FROM SAME DEPARTMENT
        // ========================================
        console.log(`🏢 Fetching all job positions from department: ${managerDepartmentName}...`);
        
        const { data: departmentJobs, error: deptJobsError } = await supabase
            .from('jobpositions')
            .select('jobId')
            .eq('departmentId', managerDepartmentId);

        if (deptJobsError) {
            console.error('❌ Error fetching department jobs:', deptJobsError);
            return res.status(500).send('Error: Unable to fetch department positions');
        }

        const departmentJobIds = departmentJobs?.map(job => job.jobId) || [];
        console.log(`🏢 Found ${departmentJobIds.length} positions in department: ${managerDepartmentName}`);
        console.log('🏢 Department job IDs:', departmentJobIds);

        // ========================================
        // STEP 3: GET ALL EMPLOYEES FROM DEPARTMENT JOBS
        // ========================================
        console.log(`👥 Fetching employees from department positions...`);
        
        let departmentEmployees = [];
        if (departmentJobIds.length > 0) {
            const { data: employees, error: deptEmployeesError } = await supabase
                .from('staffaccounts')
                .select('userId')
                .in('jobId', departmentJobIds)
                .neq('userId', currentUserId); // Exclude the line manager

            if (deptEmployeesError) {
                console.error('❌ Error fetching department employees:', deptEmployeesError);
                return res.status(500).send('Error: Unable to fetch department employees');
            }

            departmentEmployees = employees || [];
        }

        const departmentUserIds = departmentEmployees?.map(emp => emp.userId) || [];
        console.log(`👥 Found ${departmentUserIds.length} employees in department: ${managerDepartmentName}`);
        console.log('👥 Department employee IDs:', departmentUserIds);

        // ========================================
        // STEP 4: FETCH TRAINING RECORDS (DEPARTMENT FILTERED)
        // ========================================
        console.log('📋 Fetching training records for department employees only...');
        
        let trainingRecords = [];
        if (departmentUserIds.length > 0) {
            const { data: records, error: trainingError } = await supabase
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
                .in('userId', departmentUserIds) // ✅ FILTER BY DEPARTMENT EMPLOYEES ONLY
                .order('dateRequested', { ascending: false });

            if (trainingError) {
                console.error('❌ Error fetching training records:', trainingError);
                throw trainingError;
            }

            trainingRecords = records || [];
        }

        console.log(`📋 Training records found: ${trainingRecords.length} (filtered by department: ${managerDepartmentName})`);

        // ========================================
        // STEP 5: GET STAFF NAMES FOR TRAINING RECORDS
        // ========================================
        const trainingUserIds = trainingRecords ? [...new Set(trainingRecords.map(record => record.userId))] : [];
        console.log('👥 User IDs from training records:', trainingUserIds);

        let staffNames = [];
        if (trainingUserIds.length > 0) {
            const { data: staffData, error: staffError } = await supabase
                .from('staffaccounts')
                .select('userId, firstName, lastName')
                .in('userId', trainingUserIds);

            if (staffError) {
                console.error('❌ Error fetching staff names:', staffError);
            } else {
                staffNames = staffData || [];
                console.log('📝 Staff names fetched:', staffNames?.length);
            }
        }

        // Create lookup map for names
        const nameMap = {};
        staffNames.forEach(staff => {
            if (staff?.userId) {
                nameMap[staff.userId] = staff;
                console.log(`🗺️ Added to map: userId ${staff.userId} = ${staff.firstName} ${staff.lastName}`);
            }
        });

        // Merge names with training records
        const trainingRecordsWithNames = trainingRecords ? trainingRecords.map(record => {
            const nameData = nameMap[record.userId];
            console.log(`🔗 Looking up userId ${record.userId}:`, nameData);
            
            const fullName = nameData ? 
                `${nameData.firstName || ''} ${nameData.lastName || ''}`.trim() : 
                'Name not found';
            
            return {
                ...record,
                staffaccounts: nameData || null,
                fullName: fullName
            };
        }) : [];

        console.log('📊 Training records with names:', trainingRecordsWithNames?.length);

        // ========================================
        // STEP 6: FETCH DETAILED EMPLOYEE INFO FROM DEPARTMENT
        // ========================================
        console.log(`👥 Fetching detailed employee info from department: ${managerDepartmentName}...`);
        
        let employees = [];
        if (departmentJobIds.length > 0) {
            const { data: employeeData, error: employeesError } = await supabase
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
                .in('jobId', departmentJobIds) // ✅ FILTER BY DEPARTMENT JOB IDS
                .neq('userId', currentUserId) // Exclude the line manager
                .order('firstName', { ascending: true });

            if (employeesError) {
                console.error('❌ Error fetching detailed employees:', employeesError);
            } else {
                employees = employeeData || [];
            }
        }

        console.log(`👥 Found ${employees?.length || 0} detailed employees in department: ${managerDepartmentName}`);

        // ========================================
        // STEP 7: PROCESS EMPLOYEES WITH TRAINING STATUS
        // ========================================
        const processedEmployees = employees ? await Promise.all(
            employees
                .filter(employee => {
                    // Validate employee data
                    const hasValidDepartment = employee.jobpositions?.departmentId === managerDepartmentId;
                    const hasJobTitle = employee.jobpositions?.jobTitle;
                    const hasDepartmentName = employee.jobpositions?.departments?.deptName;
                    const hasValidUserData = employee.firstName && employee.lastName;
                    
                    if (!hasValidDepartment || !hasJobTitle || !hasDepartmentName || !hasValidUserData) {
                        console.log(`⚠️ Excluding employee ${employee.firstName} ${employee.lastName} - missing required data`);
                        return false;
                    }
                    
                    console.log(`✅ Including employee ${employee.firstName} ${employee.lastName} from ${hasDepartmentName}`);
                    return true;
                })
                .map(async (employee) => {
                    // Get latest training status for this employee
                    const { data: latestTraining, error: trainingError } = await supabase
                        .from('training_records')
                        .select('status, dateRequested, trainingName')
                        .eq('userId', employee.userId)
                        .order('dateRequested', { ascending: false })
                        .limit(1);

                    if (trainingError) {
                        console.error(`❌ Error fetching training for user ${employee.userId}:`, trainingError);
                    }

                    // Determine status
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
                        const statusClassMap = {
                            'For Line Manager Endorsement': 'status-pending-lm',
                            'For HR Approval': 'status-pending-hr',
                            'Cancelled': 'status-cancelled',
                            'Not Started': 'status-not-started',
                            'In Progress': 'status-in-progress',
                            'Completed': 'status-completed'
                        };
                        statusClass = statusClassMap[training.status] || 'status-unknown';
                    }

                    console.log(`👤 Employee ${employee.firstName} ${employee.lastName} - Status: ${employeeStatus}`);

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
                        latestTraining: latestTrainingInfo
                    };
                })
        ) : [];

        console.log(`👥 Processed employees: ${processedEmployees?.length || 0}`);

        // ========================================
        // STEP 8: CALCULATE DEPARTMENT-SPECIFIC STATISTICS
        // ========================================
        const totalPendingEndorsements = trainingRecordsWithNames?.length || 0;
        
        const trainingByType = {};
        const costSummary = {
            totalCost: 0,
            averageCost: 0,
            onlineTrainings: 0,
            onsiteTrainings: 0
        };

        // Training Status Statistics (Department-specific)
        const statusStats = {
            forLineManagerEndorsement: 0,
            forHRApproval: 0,
            cancelled: 0,
            notStarted: 0,
            inProgress: 0,
            completed: 0,
            noTraining: 0
        };

        // Process training records for statistics
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

        // Count status from department employees only
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

        // Monthly trends (department-specific)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        let monthlyRequests = [];
        if (departmentUserIds.length > 0) {
            const { data: monthlyData, error: monthlyError } = await supabase
                .from('training_records')
                .select('dateRequested')
                .eq('status', 'For Line Manager Endorsement')
                .in('userId', departmentUserIds) // ✅ FILTER BY DEPARTMENT
                .gte('dateRequested', sixMonthsAgo.toISOString());

            if (monthlyError) {
                console.error('❌ Error fetching monthly trends:', monthlyError);
            } else {
                monthlyRequests = monthlyData || [];
            }
        }

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
            statusStats,
            monthlyTrends: monthlyTrendsArray,
            totalEmployees: processedEmployees?.length || 0,
            departmentName: managerDepartmentName,
            departmentId: managerDepartmentId
        };

        console.log('📊 Department-specific Statistics:', statistics);

        // ========================================
        // STEP 9: RENDER PAGE
        // ========================================
        res.render('staffpages/linemanager_pages/trainingdevelopmenttracker', {
            title: `Training & Development - ${managerDepartmentName}`,
            user: req.session?.user || null,
            trainingRecords: trainingRecordsWithNames || [],
            employees: processedEmployees || [],
            statistics: statistics
        });
        
        console.log('✅ Page rendered successfully');
        console.log(`📋 Department Summary for ${managerDepartmentName}:`);
        console.log(`   - Department ID: ${managerDepartmentId}`);
        console.log(`   - Department Job IDs: ${departmentJobIds.length}`);
        console.log(`   - Department Employee IDs: ${departmentUserIds.length}`);
        console.log(`   - Training Records (Pending): ${trainingRecordsWithNames?.length || 0}`);
        console.log(`   - Total Department Employees: ${processedEmployees?.length || 0}`);
        console.log(`   - Pending Endorsements: ${totalPendingEndorsements}`);
        console.log(`   - Status Breakdown:`, statusStats);
        
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

        // Fetch midyear IDP details for employee context
        const { data: midyearIdp, error: midyearError } = await supabase
            .from('midyearidps')
            .select(`
                midyearidpId,
                profAreasForDevelopment,
                profActionsToTake,
                leaderAreasForDevelopment,
                leaderActionsToTake,
                nextRoleShortTerm,
                nextRoleLongTerm,
                nextRoleMobility,
                trainingRemarks,
                trainingCategories,
                topDevAreas,
                year,
                created_at
            `)
            .eq('userId', training.userId)
            .order('year', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (midyearError) {
            console.error('❌ Error fetching midyear IDP:', midyearError);
        }

        training.midyearIdp = midyearIdp || null;
        console.log(`📋 Midyear IDP found: ${midyearIdp ? 'Yes' : 'No'}`);

        // Fetch final year IDP details for employee context
        const { data: finalyearIdp, error: finalyearError } = await supabase
            .from('finalyearidps')
            .select(`
                finalyearidpId,
                profAreasForDevelopment,
                profActionsToTake,
                leaderAreasForDevelopment,
                leaderActionsToTake,
                nextRoleShortTerm,
                nextRoleLongTerm,
                nextRoleMobility,
                trainingRemarks,
                trainingCategories,
                topDevAreas,
                year,
                created_at
            `)
            .eq('userId', training.userId)
            .order('year', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (finalyearError) {
            console.error('❌ Error fetching final year IDP:', finalyearError);
        }

        training.finalyearIdp = finalyearIdp || null;
        console.log(`📋 Final year IDP found: ${finalyearIdp ? 'Yes' : 'No'}`);

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

        console.log('✅ Training details fetched successfully with IDP context');

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
            
            // FIXED: Get current leave balance with better error handling and ordering
            const { data: balanceData, error: balanceError } = await supabase
                .from('leavebalances')
                .select('usedLeaves, remainingLeaves, totalLeaves, created_at')
                .eq('userId', leaveRequest.userId)
                .eq('leaveTypeId', leaveRequest.leaveTypeId)
                .order('created_at', { ascending: false })
                .limit(1);
                
            console.log('Raw balance data from database:', balanceData);
            console.log('Balance error:', balanceError);
                
            if (balanceError) {
                console.error('Error fetching leave balance:', balanceError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error fetching leave balance data' 
                });
            }
            
            // FIXED: Better handling of balance data
            let currentUsedLeaves, currentRemainingLeaves, totalLeaves;
            
            if (!balanceData || balanceData.length === 0) {
                // No balance record exists - get default from leave type
                console.log('No balance record found, fetching leave type defaults');
                
                const { data: leaveTypeData, error: leaveTypeError } = await supabase
                    .from('leave_types')
                    .select('typeMaxCount')
                    .eq('leaveTypeId', leaveRequest.leaveTypeId)
                    .single();
                    
                if (leaveTypeError || !leaveTypeData) {
                    console.error('Error fetching leave type data:', leaveTypeError);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Error fetching leave type information' 
                    });
                }
                
                totalLeaves = leaveTypeData.typeMaxCount || 0;
                currentUsedLeaves = 0;
                currentRemainingLeaves = totalLeaves;
                
                console.log(`Using defaults - Total: ${totalLeaves}, Used: ${currentUsedLeaves}, Remaining: ${currentRemainingLeaves}`);
            } else {
                // Balance record exists - use actual values with proper null checking
                const balance = balanceData[0];
                
                // FIXED: Use proper null checking instead of || operator
                currentUsedLeaves = balance.usedLeaves !== null && balance.usedLeaves !== undefined ? balance.usedLeaves : 0;
                currentRemainingLeaves = balance.remainingLeaves !== null && balance.remainingLeaves !== undefined ? balance.remainingLeaves : 0;
                totalLeaves = balance.totalLeaves !== null && balance.totalLeaves !== undefined ? balance.totalLeaves : 0;
                
                console.log(`Using existing balance - Total: ${totalLeaves}, Used: ${currentUsedLeaves}, Remaining: ${currentRemainingLeaves}`);
            }
            
            // FIXED: Add validation before updating
            if (currentRemainingLeaves < daysRequested) {
                console.error(`Insufficient leave balance: ${currentRemainingLeaves} remaining, ${daysRequested} requested`);
                return res.status(400).json({ 
                    success: false, 
                    message: `Insufficient leave balance. Only ${currentRemainingLeaves} days remaining, but ${daysRequested} days requested.` 
                });
            }
            
            // Calculate new balances
            const newUsedLeaves = currentUsedLeaves + daysRequested;
            const newRemainingLeaves = currentRemainingLeaves - daysRequested;
            
            console.log(`Updating leave balance:`);
            console.log(`  Used: ${currentUsedLeaves} + ${daysRequested} = ${newUsedLeaves}`);
            console.log(`  Remaining: ${currentRemainingLeaves} - ${daysRequested} = ${newRemainingLeaves}`);
            console.log(`  Total: ${totalLeaves} (unchanged)`);
            
            // FIXED: Insert new balance record instead of upsert to maintain history
            const { error: insertError } = await supabase
                .from('leavebalances')
                .insert({
                    userId: leaveRequest.userId,
                    leaveTypeId: leaveRequest.leaveTypeId,
                    usedLeaves: newUsedLeaves,
                    remainingLeaves: newRemainingLeaves,
                    totalLeaves: totalLeaves,
                    created_at: new Date().toISOString()
                });
                
            if (insertError) {
                console.error('Error inserting new leave balance:', insertError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error updating leave balance' 
                });
            } else {
                console.log('Successfully inserted new leave balance record');
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

        res.render('staffpages/linemanager_pages/manageruseraccount', { 
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
                return res.redirect('/linemanager_pages/managerpersinfocareerprog');
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
            res.render('staffpages/linemanager_pages/managerpersinfocareerprog', {
                user: userData,
                errors: req.flash('errors')
            });
        } catch (err) {
            console.error('Error in getPersInfoCareerProg controller:', err);
            req.flash('errors', { dbError: 'An error occurred while loading the personal info page.' });
            res.redirect('/linemanager_pages/manageruseraccount');
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
// 

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

sendJobOfferAlternative: async function(req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        try {
            const { userId, startDate, additionalNotes } = req.body;
            
            console.log('ALTERNATIVE APPROACH - Job Offer Send:');
            console.log('User ID:', userId);
            
            if (!userId || !startDate) {
                return res.status(400).json({ success: false, message: 'Missing required information' });
            }
            
            // ALTERNATIVE: Get jobId from the URL params or session if available
            // You might need to pass jobId from the frontend
            const jobId = req.query.jobId || req.body.jobId;
            
            if (!jobId) {
                return res.status(400).json({ success: false, message: 'Job ID is required for job offer' });
            }
            
            // Save the start date using userId directly (since your onboarding table has userId)
            const { error: startDateError } = await supabase
                .from('onboarding_position-startdate')
                .upsert({
                    userId: parseInt(userId),
                    jobId: parseInt(jobId),
                    setStartDate: startDate,
                    updatedAt: new Date().toISOString(),
                    isAccepted: false,
                    additionalNotes: additionalNotes || ''
                });
                
            if (startDateError) {
                console.error('Error saving start date:', startDateError);
                return res.status(500).json({ success: false, message: 'Failed to save start date' });
            }
            
            // Update applicant status - try multiple approaches
            let updateSuccess = false;
            
            // Try updating by userId first
            const { error: updateError1 } = await supabase
                .from('applicantaccounts')
                .update({ applicantStatus: 'P3 - PASSED - Job Offer Sent' })
                .eq('userId', userId);
                
            if (!updateError1) {
                updateSuccess = true;
                console.log('Updated status using userId');
            } else {
                // Try updating by applicantId = userId
                const { error: updateError2 } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - PASSED - Job Offer Sent' })
                    .eq('applicantId', userId);
                    
                if (!updateError2) {
                    updateSuccess = true;
                    console.log('Updated status using applicantId = userId');
                } else {
                    console.error('Both update attempts failed:', updateError1, updateError2);
                }
            }
            
            if (!updateSuccess) {
                return res.status(500).json({ success: false, message: 'Failed to update applicant status' });
            }
            
            // Get applicant name
            const { data: applicantDetails } = await supabase
                .from('users')
                .select('firstName, lastName')
                .eq('userId', userId)
                .single();
            
            const applicantName = applicantDetails ? 
                `${applicantDetails.firstName} ${applicantDetails.lastName}` : 
                'applicant';
            
            return res.json({ 
                success: true, 
                message: 'Job offer sent successfully',
                applicantName: applicantName
            });
            
        } catch (error) {
            console.error('Error in alternative sendJobOffer:', error);
            return res.status(500).json({ success: false, message: 'Internal server error' });
        }
    } else {
        return res.status(401).json({ success: false, message: 'Unauthorized access. Line Manager role required.' });
    }
},
getUserEmail: async function(req, res) {
    try {
        const { userId } = req.params;
        
        console.log(`Fetching email for userId: ${userId}`);
        
        if (!userId) {
            return res.status(400).json({ success: false, message: 'UserId is required' });
        }
        
        // Try to get email from users table first
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('email, userEmail')
            .eq('userId', userId)
            .single();
            
        if (userData && !userError) {
            const email = userData.email || userData.userEmail;
            if (email) {
                return res.json({ success: true, email: email });
            }
        }
        
        // If not found in users table, try applicantaccounts table
        const { data: applicantData, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select('userEmail')
            .eq('userId', userId)
            .single();
            
        if (applicantData && !applicantError && applicantData.userEmail) {
            return res.json({ success: true, email: applicantData.userEmail });
        }
        
        return res.status(404).json({ success: false, message: 'Email not found for this user' });
        
    } catch (error) {
        console.error('Error fetching user email:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
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
        
        console.log('🔧 FIXED: Fetching P3 interview evaluation for applicantId:', applicantId);
        
        if (!applicantId) {
            req.flash('errors', { message: 'Applicant ID is required' });
            return res.redirect('/linemanager/applicant-tracker');
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
            console.error('❌ FIXED: Error fetching applicant:', applicantError);
            req.flash('errors', { message: 'Error fetching applicant data' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // FIXED: Check that this applicant has P3 evaluation data
        if (!applicant.applicantStatus || !applicant.applicantStatus.includes('P3')) {
            console.error('❌ FIXED: Applicant not in P3 stage. Current status:', applicant.applicantStatus);
            req.flash('errors', { message: 'This applicant is not in P3 evaluation stage.' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Get applicant email, job, and department info
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', applicant.userId)
            .single();
            
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
        
        // FIXED: Get the interview evaluation data using applicantId
        const { data: interviewData, error: interviewError } = await supabase
            .from('applicant_panelscreening_assessment')
            .select('*')
            .eq('applicantUserId', applicantId)  // Use applicantId, not userId
            .order('interviewDate', { ascending: false })
            .limit(1)
            .single();
            
        if (interviewError || !interviewData) {
            console.error('❌ FIXED: Error fetching interview data:', interviewError);
            req.flash('errors', { message: 'P3 interview evaluation not found for this applicant' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        console.log('✅ FIXED: Successfully found P3 interview evaluation data');
        
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
        
        console.log('✅ FIXED: Rendering P3 view-interview-form with evaluation data');
        
        // Render the view with the evaluation data
        res.render('staffpages/linemanager_pages/view-interview-form', { evaluation });
        
    } catch (error) {
        console.error('❌ FIXED: Error in getViewInterviewForm:', error);
        req.flash('errors', { message: 'An error occurred while retrieving the P3 interview evaluation' });
        res.redirect('/linemanager/applicant-tracker');
    }
},
getViewInterviewFormByUserId: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        console.log('🔧 P3 EVAL FIX: Fetching P3 interview evaluation by userId:', userId);
        
        if (!userId) {
            req.flash('errors', { message: 'User ID is required' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // First get the applicant using userId
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
            .eq('userId', userId)
            .single();
        
        if (applicantError || !applicant) {
            console.error('❌ P3 EVAL FIX: Error fetching applicant by userId:', applicantError);
            req.flash('errors', { message: 'Error fetching applicant data' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Check that this applicant has P3 evaluation data
        if (!applicant.applicantStatus || !applicant.applicantStatus.includes('P3')) {
            console.error('❌ P3 EVAL FIX: Applicant not in P3 stage. Current status:', applicant.applicantStatus);
            req.flash('errors', { message: 'This applicant is not in P3 evaluation stage.' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Get applicant email, job, and department info
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', applicant.userId)
            .single();
            
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
        
        // Try multiple approaches to get the interview evaluation data
        let interviewData = null;
        let interviewError = null;
        
        // Try 1: Use applicantId
        if (applicant.applicantId) {
            const { data: data1, error: error1 } = await supabase
                .from('applicant_panelscreening_assessment')
                .select('*')
                .eq('applicantUserId', applicant.applicantId)
                .order('interviewDate', { ascending: false })
                .limit(1)
                .single();
                
            if (!error1 && data1) {
                interviewData = data1;
                console.log('✅ P3 EVAL FIX: Found interview data using applicantId');
            }
        }
        
        // Try 2: Use userId if applicantId didn't work
        if (!interviewData) {
            const { data: data2, error: error2 } = await supabase
                .from('applicant_panelscreening_assessment')
                .select('*')
                .eq('applicantUserId', userId)
                .order('interviewDate', { ascending: false })
                .limit(1)
                .single();
                
            if (!error2 && data2) {
                interviewData = data2;
                console.log('✅ P3 EVAL FIX: Found interview data using userId');
            } else {
                interviewError = error2;
            }
        }
            
        if (!interviewData) {
            console.error('❌ P3 EVAL FIX: Error fetching interview data:', interviewError);
            req.flash('errors', { message: 'P3 interview evaluation not found for this applicant' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        console.log('✅ P3 EVAL FIX: Successfully found P3 interview evaluation data');
        
        // Rest of the logic is the same as the original function...
        const enhancedApplicant = {
            ...applicant,
            email: userData?.userEmail || 'N/A',
            jobTitle: jobData?.jobTitle || 'N/A',
            department: deptData?.deptName || 'N/A'
        };
        
        const panelFormData = interviewData.panelFormData ? JSON.parse(interviewData.panelFormData) : {};
        
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
        
        console.log('✅ P3 EVAL FIX: Rendering P3 view-interview-form with evaluation data');
        
        res.render('staffpages/linemanager_pages/view-interview-form', { evaluation });
        
    } catch (error) {
        console.error('❌ P3 EVAL FIX: Error in getViewInterviewFormByUserId:', error);
        req.flash('errors', { message: 'An error occurred while retrieving the P3 interview evaluation' });
        res.redirect('/linemanager/applicant-tracker');
    }
},
// Pass the applicant after reviewing evaluation
passP3Applicant: async function(req, res) {
    try {
        const applicantId = req.params.applicantId;
        
        if (!applicantId) {
            req.flash('errors', { message: 'Applicant ID is required' });
            return res.redirect('/linemanager/applicant-tracker');
        }
        
        // Update the applicant status to P3 - PASSED (removed updatedAt)
        const { error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P3 - PASSED (Pending Finalization)' })
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
rejectP3Applicant: async function(req, res) {
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
           .update({ applicantStatus: 'P3 - FAILED (Pending Finalization)' })
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

            // FIXED: Enhanced panel assessment fetching with better matching
            console.log('🔍 DEBUGGING: About to fetch panel assessments...');
            
            const { data: panelAssessments, error: panelError } = await supabase
                .from('applicant_panelscreening_assessment')
                .select(`
                    applicantUserId,
                    totalAssessmentRating,
                    conclusion,
                    panelInterviewId,
                    created_at,
                    jobId
                `);
            
            if (panelError) {
                console.error('❌ Error fetching panel assessments:', panelError);
                throw panelError;
            }
            
            console.log('🔍 RAW Panel Assessments Data:', panelAssessments);
            console.log(`🔍 Found ${panelAssessments?.length || 0} panel assessment records`);
            
            // Debug: Show what userIds we're looking for
            const applicantUserIds = applicants.map(a => a.userId);
            console.log('🔍 Looking for panel assessments for userIds:', applicantUserIds);
            
            // CRITICAL FIX: Also look up by applicantId since that might be the key
            const applicantIds = applicants.map(a => a.applicantId);
            console.log('🔍 Also looking for panel assessments for applicantIds:', applicantIds);
            
            // Debug: Show what applicantUserIds exist in panel assessments
            const panelUserIds = panelAssessments?.map(p => p.applicantUserId) || [];
            console.log('🔍 Panel assessment applicantUserIds available:', panelUserIds);

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

            for (const applicant of applicants) {
                console.log(`\n🔍 Processing applicant: ${applicant.firstName} ${applicant.lastName} (userId: ${applicant.userId}, applicantId: ${applicant.applicantId})`);

                applicant.jobTitle = jobTitles.find(job => job.jobId === applicant.jobId)?.jobTitle || 'N/A';
                applicant.deptName = departments.find(dept => dept.departmentId === applicant.departmentId)?.deptName || 'N/A';
                applicant.userEmail = userAccounts.find(user => user.userId === applicant.userId)?.userEmail || 'N/A';
                applicant.birthDate = userAccounts.find(user => user.userId === applicant.userId)?.birthDate || 'N/A';

                // Match initial screening assessment
                const screeningData = screeningAssessments.find(assessment => assessment.userId === applicant.userId) || {};

                // FIXED: Enhanced panel assessment matching with multiple strategies
                console.log(`🔍 Looking for panel assessment for userId: ${applicant.userId}, applicantId: ${applicant.applicantId}`);
                
                let panelData = null;
                
                // Strategy 1: Match by userId (applicantUserId field)
                panelData = panelAssessments.find(assessment => assessment.applicantUserId === applicant.userId);
                
                if (panelData) {
                    console.log(`✅ Found panel data by userId match:`, {
                        applicantUserId: panelData.applicantUserId,
                        totalAssessmentRating: panelData.totalAssessmentRating,
                        conclusion: panelData.conclusion
                    });
                } else {
                    // Strategy 2: Match by applicantId (in case applicantUserId field stores applicantId)
                    panelData = panelAssessments.find(assessment => assessment.applicantUserId === applicant.applicantId);
                    
                    if (panelData) {
                        console.log(`✅ Found panel data by applicantId match:`, {
                            applicantUserId: panelData.applicantUserId,
                            totalAssessmentRating: panelData.totalAssessmentRating,
                            conclusion: panelData.conclusion
                        });
                    } else {
                        console.log(`❌ No panel data found for userId: ${applicant.userId} or applicantId: ${applicant.applicantId}`);
                        
                        // Show available data for debugging
                        console.log(`🔍 Available panel assessment applicantUserIds:`, panelUserIds);
                    }
                }

                // Work setup and availability logic (unchanged)
                const workSetupScore = screeningData.workSetupScore;
                const availabilityScore = screeningData.availabilityScore;
                const workSetupPassed = (workSetupScore === true || workSetupScore === 'true' || workSetupScore === '1' || workSetupScore === 1);
                const availabilityPassed = (availabilityScore === true || availabilityScore === 'true' || availabilityScore === '1' || availabilityScore === 1);

                // Merge screening assessment data (unchanged)
                applicant.initialScreeningAssessment = {
                    degreeScore: screeningData.degreeScore || 'N/A',
                    experienceScore: screeningData.experienceScore || 'N/A',
                    certificationScore: screeningData.certificationScore || 'N/A',
                    hardSkillsScore: screeningData.hardSkillsScore || 'N/A',
                    softSkillsScore: screeningData.softSkillsScore || 'N/A',
                    workSetupScore: workSetupPassed,
                    availabilityScore: availabilityPassed,
                    totalScore: screeningData.totalScore || 'N/A',
                    degree_url: screeningData.degree_url || '#',
                    cert_url: screeningData.cert_url || '#',
                    resume_url: screeningData.resume_url || '#',
                };

                // FIXED: Panel assessment data with proper handling
                if (panelData) {
                    applicant.panelAssessment = {
                        totalAssessmentRating: panelData.totalAssessmentRating || 'N/A',
                        conclusion: panelData.conclusion || 'N/A',
                        hasData: true
                    };
                    console.log(`✅ Applied panel assessment data for ${applicant.firstName}:`, applicant.panelAssessment);
                } else {
                    applicant.panelAssessment = {
                        totalAssessmentRating: 'N/A',
                        conclusion: 'N/A',
                        hasData: false
                    };
                    console.log(`❌ No panel assessment data available for ${applicant.firstName} ${applicant.lastName}`);
                }
            }

            // Final summary
            console.log('\n📊 PANEL ASSESSMENT SUMMARY:');
            applicants.forEach(applicant => {
                const hasPanel = applicant.panelAssessment.hasData;
                const rating = applicant.panelAssessment.totalAssessmentRating;
                const conclusion = applicant.panelAssessment.conclusion;
                console.log(`  ${applicant.firstName} ${applicant.lastName} (userId: ${applicant.userId}, applicantId: ${applicant.applicantId}): ${hasPanel ? '✅' : '❌'} Panel Data - Rating: ${rating}, Conclusion: ${conclusion}`);
            });

            res.render('staffpages/linemanager_pages/linemanagerapplicanttracking-jobposition', { 
                applicants,
                applicantsJSON: JSON.stringify(applicants)
            });           
        } catch (error) {
            console.error('Error fetching applicants:', error);
            res.status(500).json({ error: 'Error fetching applicants' });
        }
    } else {
        req.flash('errors', { authError: 'Unauthorized access. Line Manager role required.' });
        res.redirect('/staff/login');
    }
},

    getApplicantAssessment: async function(req, res) {
    try {
        const { userId } = req.params;
        
        console.log('Fetching assessment for userId:', userId);
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }
        
        // Fetch the assessment data
        const { data: assessment, error: assessmentError } = await supabase
            .from('applicant_initialscreening_assessment')
            .select(`
                userId,
                degreeScore,
                experienceScore,
                certificationScore,
                hardSkillsScore,
                softSkillsScore,
                workSetupScore,
                availabilityScore,
                totalScore,
                degree_url,
                cert_url,
                resume_url
            `)
            .eq('userId', userId)
            .single();
            
        if (assessmentError) {
            console.error('Error fetching assessment:', assessmentError);
            return res.status(404).json({ 
                success: false, 
                message: 'Assessment not found',
                error: assessmentError.message 
            });
        }
        
        // Fetch applicant basic info
        const { data: applicant, error: applicantError } = await supabase
            .from('applicantaccounts')
            .select('firstName, lastName, applicantStatus, birthDate, phoneNo')
            .eq('userId', userId)
            .single();
            
        // Fetch user email
        const { data: user, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail, birthDate')
            .eq('userId', userId)
            .single();
        
        const responseData = {
            success: true,
            combinedData: {
                userId: userId,
                firstName: applicant?.firstName || 'N/A',
                lastName: applicant?.lastName || 'N/A',
                email: user?.userEmail || 'N/A',
                birthDate: user?.birthDate || applicant?.birthDate || 'N/A',
                phoneNo: applicant?.phoneNo || 'N/A',
                status: applicant?.applicantStatus || 'N/A',
                scores: {
                    degree: assessment?.degreeScore || 'N/A',
                    experience: assessment?.experienceScore || 'N/A',
                    certifications: assessment?.certificationScore || 'N/A',
                    hardSkills: assessment?.hardSkillsScore || 'N/A',
                    softSkills: assessment?.softSkillsScore || 'N/A',
                    workSetup: assessment?.workSetupScore || 'N/A',
                    availability: assessment?.availabilityScore || 'N/A',
                    total: assessment?.totalScore || 'N/A'
                },
                documents: {
                    degree: assessment?.degree_url || '#',
                    cert: assessment?.cert_url || '#',
                    resume: assessment?.resume_url || '#'
                }
            }
        };
        
        console.log('Returning assessment data for View Evaluation');
        
        return res.json(responseData);
        
    } catch (error) {
        console.error('Error in getApplicantAssessment:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching assessment data',
            error: error.message
        });
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
                
                // 🔹 First chatbot message - congratulations
                const { error: messageError1 } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ 
                            text: "Congratulations! You have successfully passed the initial screening process. We look forward to proceeding with the next interview stage with the HR." 
                        }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P1 - PASSED'
                    }]);

                if (messageError1) {
                    console.error(`❌ [LineManager] Error adding P1 congratulatory message for ${userId}:`, messageError1);
                } else {
                    console.log(`💬 [LineManager] Sent congratulations to ${userId}`);
                }

                // 🔹 Second chatbot message - scheduling link
                const { error: messageError2 } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify({ 
                            text: "Please click the button below to schedule your next interview:",
                            buttons: [
                                {
                                    text: "Schedule Interview",
                                    value: "schedule_p1_interview",
                                    url: "/applicant/schedule-interview?stage=P1"
                                }
                            ]
                        }),
                        sender: 'bot',
                        timestamp: new Date(Date.now() + 1000).toISOString(),
                        applicantStage: 'P1 - PASSED'
                    }]);

                if (messageError2) {
                    console.error(`❌ [LineManager] Error adding P1 scheduling button for ${userId}:`, messageError2);
                } else {
                    console.log(`💬 [LineManager] Sent scheduling button to ${userId}`);
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
                
                // Update applicant status in the database to FAILED
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
                
                // 🔹 Send rejection message
                const rejectionMessage = {
                    text: "We regret to inform you that you have not been chosen as a candidate for this position. Thank you for your interest in applying at Company ABC, and we wish you the best in your future endeavors."
                };
                
                const { error: messageError } = await supabase
                    .from('chatbot_history')
                    .insert([{
                        userId,
                        message: JSON.stringify(rejectionMessage),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P1 - FAILED'
                    }]);

                if (messageError) {
                    console.error(`❌ [LineManager] Error adding P1 rejection message for ${userId}:`, messageError);
                } else {
                    console.log(`💬 [LineManager] Sent rejection message to ${userId}`);
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
            return res.status(400).json({ success: false, message: "Missing userId" });
        }
        
        console.log(`✅ [LineManager] Marking userId ${userId} as P3 PASSED (Pending Finalization)`);
        
        const { data, error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P3 - PASSED (Pending Finalization)' })
            .eq('userId', userId);
        
        if (error) {
            console.error('❌ [LineManager] Error marking as P3 PASSED:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
        
        return res.status(200).json({ 
            success: true, 
            message: 'Applicant marked as P3 PASSED (Pending Finalization)' 
        });
        
    } catch (error) {
        console.error('❌ [LineManager] Error in markAsP3Passed:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
},

markAsP3Failed: async function(req, res) {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: "Missing userId" });
        }
        
        console.log(`✅ [LineManager] Marking userId ${userId} as P3 FAILED (Pending Finalization)`);
        
        const { data, error } = await supabase
            .from('applicantaccounts')
            .update({ applicantStatus: 'P3 - FAILED (Pending Finalization)' })
            .eq('userId', userId);
        
        if (error) {
            console.error('❌ [LineManager] Error marking as P3 FAILED:', error);
            return res.status(500).json({ success: false, message: error.message });
        }
        
        return res.status(200).json({ 
            success: true, 
            message: 'Applicant marked as P3 FAILED (Pending Finalization)' 
        });
        
    } catch (error) {
        console.error('❌ [LineManager] Error in markAsP3Failed:', error);
        return res.status(500).json({ success: false, message: error.message });
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
//               <img src="https://your-company-logo-url.com" alt="Company ABC Logo" style="max-width: 200px; height: auto;">
//             </div>
            
//             <h1 style="color: #124A5C; text-align: center; margin-bottom: 20px;">Congratulations, ${userName}!</h1>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">We are delighted to inform you that you have successfully passed the initial screening process for your application with Company ABC.</p>
            
//             <div style="background-color: #f8f8f8; padding: 15px; border-radius: 6px; margin: 25px 0;">
//               <h2 style="color: #28a745; margin-top: 0;">What's Next?</h2>
//               <p style="font-size: 16px; line-height: 1.6; color: #333;">Our HR team will be reaching out soon with information regarding the next interview stage. You'll receive a Calendly invitation to schedule your interview at a time that works best for you.</p>
//             </div>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Please continue to monitor both your email inbox and the applicant portal for updates on your application status.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">If you have any questions in the meantime, feel free to respond to this email or contact our recruitment team at <a href="mailto:careers@primeinfra.com" style="color: #07ACB9;">careers@primeinfra.com</a>.</p>
            
//             <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
//               <p style="font-size: 14px; color: #666; text-align: center;">Best regards,<br>The Company ABC Recruitment Team</p>
//             </div>
            
//             <div style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">
//               <p>This is an automated email. Please do not reply directly to this message.</p>
//             </div>
//           </div>
//         `;
        
//         try {
//           await transporter.sendMail({
//             from: `"Company ABC Careers" <${process.env.EMAIL_USER}>`,
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
//         const rejectionMessage = "We regret to inform you that you have not been chosen as a candidate for this position. Thank you for your interest in applying at Company ABC, and we wish you the best in your future endeavors.";
        
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
//         const emailSubject = 'Update on Your Application with Company ABC';
//         const emailHtml = `
//           <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
//             <div style="text-align: center; margin-bottom: 30px;">
//               <img src="https://your-company-logo-url.com" alt="Company ABC Logo" style="max-width: 200px; height: auto;">
//             </div>
            
//             <h1 style="color: #124A5C; text-align: center; margin-bottom: 20px;">Application Update</h1>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Dear ${userName},</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Thank you for your interest in joining Company ABC and for taking the time to apply for our position.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">After careful consideration of all applications, we regret to inform you that we have decided not to proceed with your application at this time.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">Please note that this decision does not reflect on your qualifications or experience. We received many applications from qualified candidates, and the selection process was highly competitive.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">We encourage you to continue monitoring our careers page for future opportunities that match your skills and interests, as we would be happy to consider you for other positions in the future.</p>
            
//             <p style="font-size: 16px; line-height: 1.6; color: #333;">We wish you the best in your job search and future career endeavors.</p>
            
//             <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
//               <p style="font-size: 14px; color: #666; text-align: center;">Best regards,<br>The Company ABC Recruitment Team</p>
//             </div>
            
//             <div style="margin-top: 30px; font-size: 12px; color: #999; text-align: center;">
//               <p>This is an automated email. Please do not reply directly to this message.</p>
//             </div>
//           </div>
//         `;
        
//         try {
//           await transporter.sendMail({
//             from: `"Company ABC Careers" <${process.env.EMAIL_USER}>`,
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
                const rejectionMessage = "We appreciate your participation in our interview process. After careful consideration, we regret to inform you that we will not be proceeding with your application at this time. Thank you for your interest in Company ABC.";
                
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
    
    // Function to prepare P3 finalization with Gmail compose
finalizeP3ReviewGmail: async function(req, res) {
    try {
        console.log('✅ [LineManager] Preparing P3 review finalization with Gmail compose integration');
        
        const { passedUserIds, failedUserIds } = req.body;
        
        if (!passedUserIds || !failedUserIds) {
            return res.status(400).json({ success: false, message: "Missing user IDs" });
        }
        
        console.log(`✅ [LineManager] P3 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
        
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
        console.error('❌ [LineManager] Error preparing P3 review finalization:', error);
        return res.status(500).json({ success: false, message: "Error preparing P3 review finalization: " + error.message });
    }
},
// Function to get P3 email templates
getP3EmailTemplates: async function(req, res) {
    try {
        console.log('✅ [LineManager] Getting P3 email templates');
        
        const templates = {
            passed: {
                subject: 'Congratulations! Job Offer - Company ABC',
                template: `Dear {applicantName},

🎉 Congratulations! We are thrilled to extend a job offer for the {jobTitle} position at {companyName}.

After careful consideration of all candidates throughout our comprehensive interview process, we believe you are the perfect fit for our team and organization.

📋 Your Job Offer Details:
• Position: {jobTitle}
• Company: {companyName}  
• Status: Job Offer Extended
• Next Steps: Please log into your applicant portal to review and respond to the offer

We were particularly impressed with your performance during the final interview stage, and we're excited about the unique skills and perspective you'll bring to our team.

🚀 What's Next?
• Check your applicant portal for detailed offer information
• Review the complete compensation package and benefits  
• Respond to the offer within the specified timeframe
• Prepare for an exciting journey with {companyName}

We're excited to welcome you to the {companyName} family and look forward to your contribution to our continued success.

Congratulations once again!

Warm regards,
The {companyName} Recruitment Team`
            },
            failed: {
                subject: 'Thank You for Your Interest - Interview Process Complete',
                template: `Dear {applicantName},

Thank you for participating in our comprehensive interview process for the {jobTitle} position at {companyName}, including your final interview with our senior management team.

We want to express our sincere appreciation for the time, effort, and enthusiasm you demonstrated throughout our entire recruitment process. Your professionalism and the thoughtful responses you provided during all stages of our interviews were truly impressive.

After extensive deliberation and careful consideration of all candidates, we have made the difficult decision to extend an offer to another candidate whose background and experience align slightly more closely with our current specific requirements for this role.

Please know that this decision was particularly challenging for our team. You demonstrated excellent qualifications, strong technical skills, and would undoubtedly be a valuable addition to any organization.

🌟 Moving Forward:
• Your application details will remain in our talent database for future opportunities
• We may contact you if a suitable position becomes available
• Please feel free to apply for other positions that align with your skills
• Follow our careers page for new openings that might be an excellent fit

We strongly encourage you to apply for future positions with us that align with your career goals and expertise. We believe you have much to offer and would welcome the opportunity to consider you for other roles.

Thank you again for your interest in {companyName} and for the professionalism you demonstrated throughout our process. We wish you tremendous success in your career journey.

Best regards,
The {companyName} Recruitment Team`
            }
        };
        
        return res.status(200).json({ success: true, templates });
        
    } catch (error) {
        console.error('❌ [LineManager] Error getting P3 email templates:', error);
        return res.status(500).json({ success: false, message: "Error getting P3 email templates: " + error.message });
    }
},

getP3EmailTemplates: async function(req, res) {
    try {
        console.log('✅ [LineManager] Getting P3 email templates');
        
        const templates = {
            passed: {
                subject: 'Congratulations! Job Offer - Company ABC',
                template: `Dear {applicantName},

🎉 Congratulations! We are thrilled to extend a job offer for the {jobTitle} position at {companyName}.

After careful consideration of all candidates throughout our comprehensive interview process, we believe you are the perfect fit for our team and organization.

📋 Your Job Offer Details:
• Position: {jobTitle}
• Company: {companyName}  
• Status: Job Offer Extended
• Next Steps: Please log into your applicant portal to review and respond to the offer

We were particularly impressed with your performance during the final interview stage, and we're excited about the unique skills and perspective you'll bring to our team.

🚀 What's Next?
• Check your applicant portal for detailed offer information
• Review the complete compensation package and benefits  
• Respond to the offer within the specified timeframe
• Prepare for an exciting journey with {companyName}

We're excited to welcome you to the {companyName} family and look forward to your contribution to our continued success.

Congratulations once again!

Warm regards,
The {companyName} Recruitment Team`
            },
            failed: {
                subject: 'Thank You for Your Interest - Interview Process Complete',
                template: `Dear {applicantName},

Thank you for participating in our comprehensive interview process for the {jobTitle} position at {companyName}, including your final interview with our senior management team.

We want to express our sincere appreciation for the time, effort, and enthusiasm you demonstrated throughout our entire recruitment process. Your professionalism and the thoughtful responses you provided during all stages of our interviews were truly impressive.

After extensive deliberation and careful consideration of all candidates, we have made the difficult decision to extend an offer to another candidate whose background and experience align slightly more closely with our current specific requirements for this role.

Please know that this decision was particularly challenging for our team. You demonstrated excellent qualifications, strong technical skills, and would undoubtedly be a valuable addition to any organization.

🌟 Moving Forward:
• Your application details will remain in our talent database for future opportunities
• We may contact you if a suitable position becomes available
• Please feel free to apply for other positions that align with your skills
• Follow our careers page for new openings that might be an excellent fit

We strongly encourage you to apply for future positions with us that align with your career goals and expertise. We believe you have much to offer and would welcome the opportunity to consider you for other roles.

Thank you again for your interest in {companyName} and for the professionalism you demonstrated throughout our process. We wish you tremendous success in your career journey.

Best regards,
The {companyName} Recruitment Team`
            }
        };
        
        return res.status(200).json({ success: true, templates });
        
    } catch (error) {
        console.error('❌ [LineManager] Error getting P3 email templates:', error);
        return res.status(500).json({ success: false, message: "Error getting P3 email templates: " + error.message });
    }
},

// Add P3 status update function
// Add P3 status update function
updateP3Statuses: async function(req, res) {
    try {
        console.log('✅ [LineManager] Updating P3 statuses after Gmail emails sent');
        
        const { passedUserIds, failedUserIds } = req.body;
        
        if (!passedUserIds || !failedUserIds) {
            return res.status(400).json({ success: false, message: "Missing user IDs" });
        }
        
        console.log(`✅ [LineManager] P3 Status Update: ${passedUserIds.length} passed, ${failedUserIds.length} failed`);
        
        let updateResults = {
            passed: { updated: 0, errors: [] },
            failed: { updated: 0, errors: [] }
        };
        
        // Update passed applicants
        for (const userId of passedUserIds) {
            try {
                console.log(`✅ [LineManager] Updating P3 PASSED status for userId: ${userId}`);
                
                // Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - PASSED' })
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
                        message: JSON.stringify({ text: "Congratulations! You have been selected for the position. We will be contacting you soon with job offer details." }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - PASSED'
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
                console.log(`✅ [LineManager] Updating P3 FAILED status for userId: ${userId}`);
                
                // Update applicant status in the database
                const { data: updateData, error: updateError } = await supabase
                    .from('applicantaccounts')
                    .update({ applicantStatus: 'P3 - FAILED' })
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
                        message: JSON.stringify({ text: "Thank you for participating in our interview process. After careful consideration, we regret to inform you that we will not be proceeding with your application at this time." }),
                        sender: 'bot',
                        timestamp: new Date().toISOString(),
                        applicantStage: 'P3 - FAILED'
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
            console.warn(`⚠️ [LineManager] P3 status update completed with ${totalErrors} errors`);
            return res.status(207).json({ // 207 Multi-Status for partial success
                success: true,
                message: `P3 statuses updated with some errors. ${totalUpdated} successful, ${totalErrors} failed.`,
                updateResults: updateResults,
                passedUpdated: updateResults.passed.updated,
                failedUpdated: updateResults.failed.updated,
                totalErrors: totalErrors
            });
        } else {
            console.log(`✅ [LineManager] P3 status update completed successfully`);
            return res.status(200).json({ 
                success: true, 
                message: "P3 statuses updated successfully. All applicants have been processed.",
                updateResults: updateResults,
                passedUpdated: updateResults.passed.updated,
                failedUpdated: updateResults.failed.updated,
                totalUpdated: totalUpdated
            });
        }
        
    } catch (error) {
        console.error('❌ [LineManager] Error updating P3 statuses:', error);
        return res.status(500).json({ 
            success: false, 
            message: "Error updating P3 statuses: " + error.message 
        });
    }
},

getP3Assessment: async function(req, res) {
    try {
        const { userId } = req.params;
        
        console.log(`Fetching P3 assessment for userId: ${userId}`);
        
        // FIXED: Remove .single() to handle cases where no data exists
        const { data: panelAssessments, error } = await supabase
            .from('applicant_panelscreening_assessment')
            .select(`
                totalAssessmentRating,
                conclusion,
                panelFormData,
                strengthsRapport,
                longTermGoalsRapport,
                equipmentToolsSoftware,
                remarks,
                interviewDate,
                applicantUserId
            `)
            .eq('applicantUserId', userId);
        
        if (error) {
            console.error('Error fetching P3 assessment:', error);
            return res.status(500).json({
                success: false,
                message: 'Database error fetching P3 assessment',
                error: error.message
            });
        }
        
        // Handle multiple scenarios
        if (!panelAssessments || panelAssessments.length === 0) {
            console.log(`No P3 assessment found for userId: ${userId}`);
            
            // FIXED: Try searching by applicantId instead (common issue)
            console.log(`Trying to find assessment by treating userId ${userId} as applicantId...`);
            
            // First, get the applicant record to find their actual applicantId
            const { data: applicantRecord, error: applicantError } = await supabase
                .from('applicantaccounts')
                .select('applicantId')
                .eq('userId', userId)
                .single();
            
            if (!applicantError && applicantRecord) {
                console.log(`Found applicantId: ${applicantRecord.applicantId} for userId: ${userId}`);
                
                // Try searching by applicantId
                const { data: panelByApplicantId, error: panelByIdError } = await supabase
                    .from('applicant_panelscreening_assessment')
                    .select(`
                        totalAssessmentRating,
                        conclusion,
                        panelFormData,
                        strengthsRapport,
                        longTermGoalsRapport,
                        equipmentToolsSoftware,
                        remarks,
                        interviewDate,
                        applicantUserId
                    `)
                    .eq('applicantUserId', applicantRecord.applicantId);
                
                if (!panelByIdError && panelByApplicantId && panelByApplicantId.length > 0) {
                    const panelData = panelByApplicantId[0]; // Take first record if multiple
                    console.log(`✅ Found P3 assessment by applicantId for userId: ${userId}`);
                    
                    return res.json({
                        success: true,
                        assessmentData: {
                            totalAssessmentRating: panelData.totalAssessmentRating || 'N/A',
                            conclusion: panelData.conclusion || 'N/A',
                            panelFormData: panelData.panelFormData || {},
                            strengthsRapport: panelData.strengthsRapport || '',
                            longTermGoalsRapport: panelData.longTermGoalsRapport || '',
                            equipmentToolsSoftware: panelData.equipmentToolsSoftware || '',
                            remarks: panelData.remarks || '',
                            interviewDate: panelData.interviewDate || null
                        }
                    });
                }
            }
            
            // If still no data found, return N/A values instead of 404
            console.log(`No P3 assessment found for userId: ${userId} by any method`);
            return res.json({
                success: true,
                assessmentData: {
                    totalAssessmentRating: 'N/A',
                    conclusion: 'N/A',
                    panelFormData: {},
                    strengthsRapport: '',
                    longTermGoalsRapport: '',
                    equipmentToolsSoftware: '',
                    remarks: '',
                    interviewDate: null
                }
            });
        }
        
        // Take the first record if multiple exist
        const panelAssessment = panelAssessments[0];
        
        console.log(`✅ Successfully fetched P3 assessment for userId: ${userId}`);
        
        res.json({
            success: true,
            assessmentData: {
                totalAssessmentRating: panelAssessment.totalAssessmentRating || 'N/A',
                conclusion: panelAssessment.conclusion || 'N/A',
                panelFormData: panelAssessment.panelFormData || {},
                strengthsRapport: panelAssessment.strengthsRapport || '',
                longTermGoalsRapport: panelAssessment.longTermGoalsRapport || '',
                equipmentToolsSoftware: panelAssessment.equipmentToolsSoftware || '',
                remarks: panelAssessment.remarks || '',
                interviewDate: panelAssessment.interviewDate || null
            }
        });
        
    } catch (error) {
        console.error('Error in get-p3-assessment route:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
},

// Send automated email (individual)
sendAutomatedEmail: async function(req, res) {
    try {
        console.log('✅ [LineManager] Sending automated email');
        
        const { email, subject, template, applicantName, jobTitle, phase, type } = req.body;
        
        if (!email || !subject || !template || !applicantName || !jobTitle) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing required email parameters" 
            });
        }
        
        console.log(`✅ [LineManager] Sending ${type} email to: ${email}`);
        
        // Send email using the email service
        const result = await sendCustomEmail(
            email,
            subject,
            template,
            applicantName,
            jobTitle
        );
        
        if (result.success) {
            console.log(`✅ [LineManager] Email sent successfully to ${email}: ${result.messageId}`);
            return res.status(200).json({
                success: true,
                messageId: result.messageId,
                message: 'Email sent successfully'
            });
        } else {
            console.error(`❌ [LineManager] Failed to send email to ${email}: ${result.error}`);
            return res.status(500).json({
                success: false,
                message: result.error || 'Failed to send email'
            });
        }
        
    } catch (error) {
        console.error('❌ [LineManager] Error sending automated email:', error);
        return res.status(500).json({
            success: false,
            message: 'Error sending automated email: ' + error.message
        });
    }
},

// Send bulk emails (batch process)
sendBulkEmails: async function(req, res) {
    try {
        console.log('✅ [LineManager] Starting bulk email sending process');
        
        const { applicants, subject, template, phase, type } = req.body;
        
        if (!applicants || !Array.isArray(applicants) || applicants.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid applicants data" 
            });
        }
        
        if (!subject || !template) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing email subject or template" 
            });
        }
        
        console.log(`✅ [LineManager] Bulk sending ${applicants.length} ${type} emails for ${phase}`);
        
        // Generate batch ID
        const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Initialize batch tracking
        emailBatches.set(batchId, {
            total: applicants.length,
            sent: 0,
            failed: 0,
            errors: [],
            startTime: new Date(),
            status: 'processing'
        });
        
        // Process emails in background
        processEmailBatch(batchId, applicants, subject, template);
        
        return res.status(200).json({
            success: true,
            batchId: batchId,
            message: 'Bulk email process started',
            totalEmails: applicants.length
        });
        
    } catch (error) {
        console.error('❌ [LineManager] Error starting bulk email process:', error);
        return res.status(500).json({
            success: false,
            message: 'Error starting bulk email process: ' + error.message
        });
    }
},

// Get email sending status
getEmailStatus: async function(req, res) {
    try {
        const { batchId } = req.params;
        
        if (!emailBatches.has(batchId)) {
            return res.status(404).json({
                success: false,
                message: 'Batch ID not found'
            });
        }
        
        const batchInfo = emailBatches.get(batchId);
        
        return res.status(200).json({
            success: true,
            batch: batchInfo
        });
        
    } catch (error) {
        console.error('❌ [LineManager] Error getting email status:', error);
        return res.status(500).json({
            success: false,
            message: 'Error getting email status: ' + error.message
        });
    }
},

// Enhanced P1 finalization with automated emails
finalizeP1ReviewWithEmails: async function(req, res) {
    try {
        console.log('✅ [LineManager] P1 review finalization with automated emails');
        
        const { passedUserIds, failedUserIds, sendEmails = false, emailData } = req.body;
        
        if (!passedUserIds || !failedUserIds) {
            return res.status(400).json({ success: false, message: "Missing user IDs" });
        }
        
        console.log(`✅ [LineManager] P1 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed, sendEmails: ${sendEmails}`);
        
        // Fetch applicant data
        const applicantData = await fetchApplicantDataForEmails(passedUserIds, failedUserIds);
        
        if (sendEmails && emailData) {
            // Send automated emails
            const emailResults = await sendAutomatedP1Emails(
                applicantData.passedApplicants,
                applicantData.failedApplicants,
                emailData
            );
            
            // Update statuses if emails were sent successfully
            if (emailResults.success) {
                await updateP1StatusesAfterEmails(passedUserIds, failedUserIds);
                
                return res.status(200).json({
                    success: true,
                    message: 'P1 review finalized and emails sent successfully',
                    emailResults: emailResults,
                    passedUpdated: passedUserIds.length,
                    failedUpdated: failedUserIds.length
                });
            } else {
                return res.status(207).json({
                    success: false,
                    message: 'P1 review processed but some emails failed',
                    emailResults: emailResults
                });
            }
        } else {
            // Just return applicant data for manual processing
            return res.status(200).json({ 
                success: true,
                requiresEmailCompose: true,
                passedApplicants: applicantData.passedApplicants,
                failedApplicants: applicantData.failedApplicants,
                message: "Ready for email composition"
            });
        }
        
    } catch (error) {
        console.error('❌ [LineManager] Error in P1 review finalization with emails:', error);
        return res.status(500).json({ 
            success: false, 
            message: "Error in P1 review finalization: " + error.message 
        });
    }
},

// Enhanced P3 finalization with automated emails
finalizeP3ReviewWithEmails: async function(req, res) {
    try {
        console.log('✅ [LineManager] P3 review finalization with automated emails');
        
        const { passedUserIds, failedUserIds, sendEmails = false, emailData } = req.body;
        
        if (!passedUserIds || !failedUserIds) {
            return res.status(400).json({ success: false, message: "Missing user IDs" });
        }
        
        console.log(`✅ [LineManager] P3 Finalization: ${passedUserIds.length} passed, ${failedUserIds.length} failed, sendEmails: ${sendEmails}`);
        
        // Fetch applicant data
        const applicantData = await fetchApplicantDataForEmails(passedUserIds, failedUserIds);
        
        if (sendEmails && emailData) {
            // Send automated emails
            const emailResults = await sendAutomatedP3Emails(
                applicantData.passedApplicants,
                applicantData.failedApplicants,
                emailData
            );
            
            // Update statuses if emails were sent successfully
            if (emailResults.success) {
                await updateP3StatusesAfterEmails(passedUserIds, failedUserIds);
                
                return res.status(200).json({
                    success: true,
                    message: 'P3 review finalized and emails sent successfully',
                    emailResults: emailResults,
                    passedUpdated: passedUserIds.length,
                    failedUpdated: failedUserIds.length
                });
            } else {
                return res.status(207).json({
                    success: false,
                    message: 'P3 review processed but some emails failed',
                    emailResults: emailResults
                });
            }
        } else {
            // Just return applicant data for manual processing
            return res.status(200).json({ 
                success: true,
                requiresEmailCompose: true,
                passedApplicants: applicantData.passedApplicants,
                failedApplicants: applicantData.failedApplicants,
                message: "Ready for email composition"
            });
        }
        
    } catch (error) {
        console.error('❌ [LineManager] Error in P3 review finalization with emails:', error);
        return res.status(500).json({ 
            success: false, 
            message: "Error in P3 review finalization: " + error.message 
        });
    }
},

// Get user email for job offer system
getUserEmail: async function(req, res) {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ success: false, message: "Missing userId" });
        }
        
        console.log(`✅ [LineManager] Fetching email for userId: ${userId}`);
        
        const { data: userData, error: userError } = await supabase
            .from('useraccounts')
            .select('userEmail')
            .eq('userId', userId)
            .single();
            
        if (userError) {
            console.error('❌ [LineManager] Error fetching user email:', userError);
            return res.status(404).json({ 
                success: false, 
                message: "User not found" 
            });
        }
        
        return res.status(200).json({
            success: true,
            email: userData.userEmail
        });
        
    } catch (error) {
        console.error('❌ [LineManager] Error getting user email:', error);
        return res.status(500).json({
            success: false,
            message: 'Error getting user email: ' + error.message
        });
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

saveMidYearIDP: async function(req, res) {
    try {
        const userId = req.params.userId || req.body.userId;
        
        console.log("=== STARTING ENHANCED saveMidYearIDP DEBUG ===");
        console.log("Starting enhanced saveMidYearIDP for userId:", userId);
        console.log("Request method:", req.method);
        console.log("Content-Type:", req.headers['content-type']);
        console.log("Request body keys:", Object.keys(req.body));
        
        // Log full request body with pretty printing
        console.log("=== FULL REQUEST BODY ===");
        console.log(JSON.stringify(req.body, null, 2));
        console.log("=== END FULL REQUEST BODY ===");

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
            topDevAreas, // ENHANCED: Add top 5 development areas
            year
        } = req.body;

        // ENHANCED DEBUG: Log each field including topDevAreas
        console.log("=== RAW FIELD VALUES ===");
        console.log("profStrengths type:", typeof profStrengths, "length:", profStrengths?.length);
        console.log("profAreasForDevelopment type:", typeof profAreasForDevelopment, "length:", profAreasForDevelopment?.length);
        console.log("profActionsToTake type:", typeof profActionsToTake, "length:", profActionsToTake?.length);
        console.log("leaderStrengths type:", typeof leaderStrengths, "length:", leaderStrengths?.length);
        console.log("leaderAreasForDevelopment type:", typeof leaderAreasForDevelopment, "length:", leaderAreasForDevelopment?.length);
        console.log("leaderActionsToTake type:", typeof leaderActionsToTake, "length:", leaderActionsToTake?.length);
        console.log("nextRoleShortTerm type:", typeof nextRoleShortTerm, "length:", nextRoleShortTerm?.length);
        console.log("nextRoleLongTerm type:", typeof nextRoleLongTerm, "length:", nextRoleLongTerm?.length);
        console.log("nextRoleMobility type:", typeof nextRoleMobility, "length:", nextRoleMobility?.length);
        console.log("trainingRemarks type:", typeof trainingRemarks, "length:", trainingRemarks?.length);
        console.log("year type:", typeof year, "value:", year);
        
        // ENHANCED: Debug topDevAreas
        console.log("=== TOP 5 DEVELOPMENT AREAS DEBUG ===");
        console.log("topDevAreas RAW value:", topDevAreas);
        console.log("topDevAreas type:", typeof topDevAreas);
        console.log("topDevAreas isArray:", Array.isArray(topDevAreas));
        console.log("topDevAreas length:", topDevAreas?.length);
        console.log("topDevAreas JSON:", JSON.stringify(topDevAreas));
        
        if (Array.isArray(topDevAreas)) {
            topDevAreas.forEach((item, index) => {
                console.log(`topDevAreas[${index}]:`, {
                    rank: item.rank,
                    type: item.type,
                    name: item.name,
                    averageRating: item.averageRating
                });
            });
        }
        console.log("=== END TOP 5 DEVELOPMENT AREAS DEBUG ===");
        
        // CRITICAL DEBUG FOR TRAINING CATEGORIES (existing code)
        console.log("=== TRAINING CATEGORIES CRITICAL DEBUG ===");
        console.log("trainingCategories RAW value:", trainingCategories);
        console.log("trainingCategories type:", typeof trainingCategories);
        console.log("trainingCategories constructor:", trainingCategories?.constructor?.name);
        console.log("trainingCategories isArray:", Array.isArray(trainingCategories));
        console.log("trainingCategories length:", trainingCategories?.length);
        console.log("trainingCategories JSON:", JSON.stringify(trainingCategories));
        
        // Log each item if it's an array
        if (Array.isArray(trainingCategories)) {
            trainingCategories.forEach((item, index) => {
                console.log(`trainingCategories[${index}]:`, {
                    value: item,
                    type: typeof item,
                    length: item?.length,
                    json: JSON.stringify(item)
                });
            });
        }
        console.log("=== END TRAINING CATEGORIES CRITICAL DEBUG ===");

        // Process training categories (existing code)
        let processedTrainingCategories = [];
        
        console.log("=== TRAINING CATEGORIES PROCESSING ===");
        
        if (trainingCategories !== null && trainingCategories !== undefined) {
            if (Array.isArray(trainingCategories)) {
                console.log("✅ Processing as array with", trainingCategories.length, "items");
                
                processedTrainingCategories = trainingCategories
                    .map((cat, index) => {
                        console.log(`Processing item ${index}:`, {
                            value: cat,
                            type: typeof cat,
                            constructor: cat?.constructor?.name
                        });
                        
                        if (typeof cat === 'string') {
                            const trimmed = cat.trim();
                            console.log(`  ✅ String item ${index}: "${trimmed}"`);
                            return trimmed;
                        } else if (typeof cat === 'object' && cat !== null) {
                            const name = (cat.name || cat.category || '').toString().trim();
                            console.log(`  ✅ Object item ${index}: "${name}" (from ${cat.name ? 'name' : 'category'} property)`);
                            return name;
                        } else {
                            console.log(`  ❌ Invalid item ${index}:`, cat, typeof cat);
                            return '';
                        }
                    })
                    .filter((cat, index) => {
                        const isValid = cat && cat.length > 0;
                        console.log(`  Filter result ${index}: "${cat}" (valid: ${isValid})`);
                        return isValid;
                    });
                    
                console.log("✅ Processed array result:", processedTrainingCategories);
            } else {
                // Handle string or other formats (existing logic)
                processedTrainingCategories = [];
            }
        } else {
            console.log("trainingCategories is null/undefined");
            processedTrainingCategories = [];
        }

        // ENHANCED: Process top 5 development areas
        let processedTopDevAreas = [];
        
        console.log("=== TOP 5 DEVELOPMENT AREAS PROCESSING ===");
        
        if (topDevAreas !== null && topDevAreas !== undefined) {
            if (Array.isArray(topDevAreas)) {
                console.log("✅ Processing topDevAreas as array with", topDevAreas.length, "items");
                
                processedTopDevAreas = topDevAreas
                    .filter(area => area && typeof area === 'object')
                    .map((area, index) => {
                        console.log(`Processing development area ${index}:`, area);
                        
                        // Validate required fields
                        if (!area.type || !area.name || typeof area.averageRating !== 'number') {
                            console.warn(`  ❌ Invalid development area ${index}:`, area);
                            return null;
                        }
                        
                        const processedArea = {
                            rank: area.rank || (index + 1),
                            type: area.type, // 'objective' or 'skill'
                            name: area.name.toString().trim(),
                            averageRating: parseFloat(area.averageRating),
                            quarterRatings: area.quarterRatings || {}
                        };
                        
                        // Add type-specific fields
                        if (area.type === 'objective') {
                            if (area.objectiveId) processedArea.objectiveId = area.objectiveId;
                            if (area.kpi) processedArea.kpi = area.kpi.toString().trim();
                        } else if (area.type === 'skill') {
                            if (area.skillId) processedArea.skillId = area.skillId;
                            if (area.skillType) processedArea.skillType = area.skillType.toString().trim();
                        }
                        
                        console.log(`  ✅ Processed development area ${index}:`, processedArea);
                        return processedArea;
                    })
                    .filter(area => area !== null)
                    .slice(0, 5); // Ensure max 5 items
                    
                console.log("✅ Final processed topDevAreas:", processedTopDevAreas);
            } else if (typeof topDevAreas === 'string') {
                console.log("Processing topDevAreas as string, attempting JSON parse");
                try {
                    const parsed = JSON.parse(topDevAreas);
                    if (Array.isArray(parsed)) {
                        processedTopDevAreas = parsed.slice(0, 5);
                        console.log("✅ Parsed topDevAreas from JSON string:", processedTopDevAreas);
                    }
                } catch (e) {
                    console.warn("Failed to parse topDevAreas JSON string:", e);
                    processedTopDevAreas = [];
                }
            } else {
                console.log("❌ Unexpected type for topDevAreas:", typeof topDevAreas);
                processedTopDevAreas = [];
            }
        } else {
            console.log("topDevAreas is null/undefined");
            processedTopDevAreas = [];
        }

        console.log("=== FINAL PROCESSED TOP 5 DEVELOPMENT AREAS ===");
        console.log("Final processedTopDevAreas:", processedTopDevAreas);
        console.log("Length:", processedTopDevAreas.length);
        console.log("Type:", typeof processedTopDevAreas);
        console.log("Is array:", Array.isArray(processedTopDevAreas));
        console.log("JSON for database:", JSON.stringify(processedTopDevAreas));
        console.log("=== END TOP 5 DEVELOPMENT AREAS PROCESSING ===");

        // Validate processed arrays
        if (!Array.isArray(processedTrainingCategories)) {
            console.error("❌ processedTrainingCategories is not an array!");
            return res.status(400).json({ 
                success: false, 
                message: "Invalid training categories format" 
            });
        }

        if (!Array.isArray(processedTopDevAreas)) {
            console.error("❌ processedTopDevAreas is not an array!");
            return res.status(400).json({ 
                success: false, 
                message: "Invalid top development areas format" 
            });
        }

        // Clean text fields (existing code)
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

        console.log("=== CLEANED FINAL DATA ===");
        console.log("Final processed data summary:", {
            userId,
            profStrengths: profStrengths.substring(0, 50) + (profStrengths.length > 50 ? '...' : ''),
            profAreasForDevelopment: profAreasForDevelopment.substring(0, 50) + (profAreasForDevelopment.length > 50 ? '...' : ''),
            profActionsToTake: profActionsToTake.substring(0, 50) + (profActionsToTake.length > 50 ? '...' : ''),
            leaderStrengths: leaderStrengths.substring(0, 50) + (leaderStrengths.length > 50 ? '...' : ''),
            leaderAreasForDevelopment: leaderAreasForDevelopment.substring(0, 50) + (leaderAreasForDevelopment.length > 50 ? '...' : ''),
            leaderActionsToTake: leaderActionsToTake.substring(0, 50) + (leaderActionsToTake.length > 50 ? '...' : ''),
            nextRoleShortTerm: nextRoleShortTerm.substring(0, 50) + (nextRoleShortTerm.length > 50 ? '...' : ''),
            nextRoleLongTerm: nextRoleLongTerm.substring(0, 50) + (nextRoleLongTerm.length > 50 ? '...' : ''),
            nextRoleMobility: nextRoleMobility.substring(0, 50) + (nextRoleMobility.length > 50 ? '...' : ''),
            trainingCategories: processedTrainingCategories,
            topDevAreas: processedTopDevAreas, // ENHANCED
            trainingRemarks: trainingRemarks.substring(0, 100) + (trainingRemarks.length > 100 ? '...' : ''),
            year: currentYear
        });
        console.log("CRITICAL - trainingCategories for DB:", processedTrainingCategories);
        console.log("CRITICAL - topDevAreas for DB:", processedTopDevAreas); // ENHANCED
        console.log("=== END CLEANED FINAL DATA ===");

        // Check if there's already an entry for this user (existing code)
        console.log("Checking for existing record...");
        const { data: existingRecord, error: checkError } = await supabase
            .from("midyearidps")
            .select("midyearidpId")
            .eq("userId", userId)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error("Error checking for existing midyearidp:", checkError);
            return res.status(500).json({ success: false, message: "Error checking for existing record" });
        }

        console.log("Existing record check result:", existingRecord);

        // Prepare data for database insertion - ENHANCED with topDevAreas
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
            trainingCategories: processedTrainingCategories, // JSONB array
            topDevAreas: processedTopDevAreas, // ENHANCED: JSONB array of top 5 development areas
            trainingRemarks: trainingRemarks || null,
            year: currentYear
        };

        console.log("=== DATA TO SAVE TO DATABASE ===");
        console.log("Data structure to save:");
        console.log("- profStrengths length:", dataToSave.profStrengths.length);
        console.log("- profAreasForDevelopment length:", dataToSave.profAreasForDevelopment.length);
        console.log("- profActionsToTake length:", dataToSave.profActionsToTake.length);
        console.log("- leaderStrengths length:", dataToSave.leaderStrengths.length);
        console.log("- leaderAreasForDevelopment length:", dataToSave.leaderAreasForDevelopment.length);
        console.log("- leaderActionsToTake length:", dataToSave.leaderActionsToTake.length);
        console.log("- nextRoleShortTerm length:", dataToSave.nextRoleShortTerm.length);
        console.log("- nextRoleLongTerm length:", dataToSave.nextRoleLongTerm.length);
        console.log("- nextRoleMobility length:", dataToSave.nextRoleMobility.length);
        console.log("- trainingRemarks length:", dataToSave.trainingRemarks?.length || 0);
        console.log("- year:", dataToSave.year);
        
        // ENHANCED DEBUG
        console.log("=== CRITICAL - ENHANCED DATA FOR DATABASE ===");
        console.log("trainingCategories value:", dataToSave.trainingCategories);
        console.log("trainingCategories type:", typeof dataToSave.trainingCategories);
        console.log("trainingCategories isArray:", Array.isArray(dataToSave.trainingCategories));
        console.log("trainingCategories length:", dataToSave.trainingCategories.length);
        console.log("topDevAreas value:", dataToSave.topDevAreas); // ENHANCED
        console.log("topDevAreas type:", typeof dataToSave.topDevAreas); // ENHANCED
        console.log("topDevAreas isArray:", Array.isArray(dataToSave.topDevAreas)); // ENHANCED
        console.log("topDevAreas length:", dataToSave.topDevAreas.length); // ENHANCED
        console.log("=== END CRITICAL DEBUG ===");

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
                console.error("❌ Error updating midyearidp:", error);
                console.error("Error details:", JSON.stringify(error, null, 2));
                console.error("Data that failed to save:", JSON.stringify(dataToSave, null, 2));
                return res.status(500).json({ 
                    success: false, 
                    message: `Database update error: ${error.message}`,
                    errorDetails: error
                });
            }
            
            result = data;
            console.log("✅ Update successful. Result:", result);
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
                console.error("❌ Error inserting midyearidp:", error);
                console.error("Error details:", JSON.stringify(error, null, 2));
                console.error("Data that failed to save:", JSON.stringify({ userId, ...dataToSave }, null, 2));
                return res.status(500).json({ 
                    success: false, 
                    message: `Database insert error: ${error.message}`,
                    errorDetails: error
                });
            }
            
            result = data;
            console.log("✅ Insert successful. Result:", result);
        }

        // Verify the saved data - ENHANCED
        console.log("=== VERIFICATION: CHECKING SAVED DATA ===");
        const { data: verificationData, error: verificationError } = await supabase
            .from("midyearidps")
            .select("trainingCategories, topDevAreas")
            .eq("userId", userId)
            .single();

        if (verificationError) {
            console.warn("⚠️ Could not verify saved data:", verificationError);
        } else {
            console.log("✅ VERIFICATION: Saved trainingCategories in database:", verificationData.trainingCategories);
            console.log("✅ VERIFICATION: Saved topDevAreas in database:", verificationData.topDevAreas); // ENHANCED
            console.log("✅ VERIFICATION: trainingCategories type:", typeof verificationData.trainingCategories);
            console.log("✅ VERIFICATION: topDevAreas type:", typeof verificationData.topDevAreas); // ENHANCED
            console.log("✅ VERIFICATION: trainingCategories isArray:", Array.isArray(verificationData.trainingCategories));
            console.log("✅ VERIFICATION: topDevAreas isArray:", Array.isArray(verificationData.topDevAreas)); // ENHANCED
        }
        console.log("=== END VERIFICATION ===");

        console.log("=== OPERATION COMPLETED SUCCESSFULLY ===");
        console.log("✅ Mid-Year IDP saved successfully with categories:", processedTrainingCategories);
        console.log("✅ Mid-Year IDP saved successfully with top 5 development areas:", processedTopDevAreas); // ENHANCED
        console.log("✅ Total categories saved:", processedTrainingCategories.length);
        console.log("✅ Total development areas saved:", processedTopDevAreas.length); // ENHANCED
        console.log("=== END OPERATION ===");

        // If it's an API request (AJAX), return JSON
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(200).json({ 
                success: true, 
                message: "Mid-Year IDP saved successfully",
                data: result,
                savedCategories: processedTrainingCategories,
                savedTopDevAreas: processedTopDevAreas, // ENHANCED
                totalCategories: processedTrainingCategories.length,
                totalTopDevAreas: processedTopDevAreas.length, // ENHANCED
                debug: {
                    originalTrainingCategories: trainingCategories,
                    processedTrainingCategories: processedTrainingCategories,
                    originalTopDevAreas: topDevAreas, // ENHANCED
                    processedTopDevAreas: processedTopDevAreas, // ENHANCED
                    verificationData: verificationData || null
                }
            });
        }

        // Otherwise, redirect to the user's records page with success message
        req.flash('success', 'Mid-Year IDP submitted successfully!');
        return res.redirect(`/linemanager/records-performance-tracker/${userId}`);

    } catch (error) {
        console.error("=== ERROR IN ENHANCED saveMidYearIDP ===");
        console.error("❌ Error:", error);
        console.error("❌ Error stack:", error.stack);
        console.error("❌ Error message:", error.message);
        console.error("❌ Error name:", error.name);
        console.error("=== END ERROR ===");
        
        // If it's an API request (AJAX), return JSON error
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ 
                success: false, 
                message: "An error occurred while saving the Mid-Year IDP",
                error: error.message,
                debug: {
                    errorType: error.constructor.name,
                    errorMessage: error.message,
                    errorStack: error.stack
                }
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
        
        console.log("=== getMidYearIDPWithTrainings DEBUG ===");
        console.log('Fetching Mid-Year IDP with training categories for userId:', userId);

        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

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

        console.log("Raw midyear data from database:", midyearData);

        let responseData = {
            midYearData: midyearData,
            trainingCategories: [],
            trainingRemarks: null,
            suggestedTrainings: [] // Keep for backward compatibility
        };

        if (midyearData) {
            console.log("Processing midyear data...");
            console.log("Raw trainingCategories from DB:", midyearData.trainingCategories);
            console.log("Type of trainingCategories:", typeof midyearData.trainingCategories);
            
            // ENHANCED: Extract training categories from JSONB field with debugging
            if (midyearData.trainingCategories) {
                try {
                    // Parse if it's a string, or use directly if already parsed
                    let categories = midyearData.trainingCategories;
                    
                    if (typeof categories === 'string') {
                        console.log("Parsing categories from JSON string");
                        categories = JSON.parse(categories);
                    }
                    
                    if (Array.isArray(categories)) {
                        console.log('Found training categories in JSONB:', categories);
                        responseData.trainingCategories = categories;
                    } else {
                        console.log('Training categories is not an array:', categories);
                        responseData.trainingCategories = [];
                    }
                } catch (parseError) {
                    console.error('Error parsing training categories:', parseError);
                    console.error('Raw value:', midyearData.trainingCategories);
                    responseData.trainingCategories = [];
                }
            } else {
                console.log('No training categories found in database');
            }

            // Extract training remarks
            if (midyearData.trainingRemarks) {
                console.log('Found training remarks:', midyearData.trainingRemarks);
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
                console.log('Found legacy training data:', trainingsData);
                responseData.suggestedTrainings = trainingsData;
            }
        }

        console.log('Final response data structure:', {
            categoriesCount: responseData.trainingCategories.length,
            categories: responseData.trainingCategories,
            hasRemarks: !!responseData.trainingRemarks,
            legacyTrainingsCount: responseData.suggestedTrainings.length
        });
        console.log("=== END getMidYearIDPWithTrainings DEBUG ===");

        return res.status(200).json({
            success: true,
            data: responseData,
            debug: {
                rawTrainingCategories: midyearData?.trainingCategories,
                processedCategories: responseData.trainingCategories,
                categoriesType: typeof midyearData?.trainingCategories
            }
        });

    } catch (error) {
        console.error("=== ERROR in getMidYearIDPWithTrainings ===");
        console.error("Error:", error);
        console.error("Error stack:", error.stack);
        console.error("=== END ERROR ===");
        
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
        const userId = req.params.userId || req.body.userId;
        
        console.log("=== STARTING ENHANCED saveFinalYearIDP DEBUG ===");
        console.log("Starting enhanced saveFinalYearIDP for userId:", userId);
        console.log("Request method:", req.method);
        console.log("Content-Type:", req.headers['content-type']);
        console.log("Request body keys:", Object.keys(req.body));
        
        // Log full request body with pretty printing
        console.log("=== FULL FINAL-YEAR REQUEST BODY ===");
        console.log(JSON.stringify(req.body, null, 2));
        console.log("=== END FULL FINAL-YEAR REQUEST BODY ===");

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
            topDevAreas, // ENHANCED: Add top 5 development areas
            year
        } = req.body;

        // ENHANCED DEBUG: Log each field including topDevAreas
        console.log("=== FINAL-YEAR RAW FIELD VALUES ===");
        console.log("profStrengths type:", typeof profStrengths, "length:", profStrengths?.length);
        console.log("profAreasForDevelopment type:", typeof profAreasForDevelopment, "length:", profAreasForDevelopment?.length);
        console.log("profActionsToTake type:", typeof profActionsToTake, "length:", profActionsToTake?.length);
        console.log("leaderStrengths type:", typeof leaderStrengths, "length:", leaderStrengths?.length);
        console.log("leaderAreasForDevelopment type:", typeof leaderAreasForDevelopment, "length:", leaderAreasForDevelopment?.length);
        console.log("leaderActionsToTake type:", typeof leaderActionsToTake, "length:", leaderActionsToTake?.length);
        console.log("nextRoleShortTerm type:", typeof nextRoleShortTerm, "length:", nextRoleShortTerm?.length);
        console.log("nextRoleLongTerm type:", typeof nextRoleLongTerm, "length:", nextRoleLongTerm?.length);
        console.log("nextRoleMobility type:", typeof nextRoleMobility, "length:", nextRoleMobility?.length);
        console.log("trainingRemarks type:", typeof trainingRemarks, "length:", trainingRemarks?.length);
        console.log("year type:", typeof year, "value:", year);
        
        // ENHANCED: Debug topDevAreas for Final-Year
        console.log("=== FINAL-YEAR TOP 5 DEVELOPMENT AREAS DEBUG ===");
        console.log("topDevAreas RAW value:", topDevAreas);
        console.log("topDevAreas type:", typeof topDevAreas);
        console.log("topDevAreas isArray:", Array.isArray(topDevAreas));
        console.log("topDevAreas length:", topDevAreas?.length);
        console.log("topDevAreas JSON:", JSON.stringify(topDevAreas));
        
        if (Array.isArray(topDevAreas)) {
            topDevAreas.forEach((item, index) => {
                console.log(`topDevAreas[${index}]:`, {
                    rank: item.rank,
                    type: item.type,
                    name: item.name,
                    averageRating: item.averageRating
                });
            });
        }
        console.log("=== END FINAL-YEAR TOP 5 DEVELOPMENT AREAS DEBUG ===");
        
        // FINAL-YEAR: Debug trainingCategories
        console.log("=== FINAL-YEAR TRAINING CATEGORIES DEBUG ===");
        console.log("trainingCategories RAW value:", trainingCategories);
        console.log("trainingCategories type:", typeof trainingCategories);
        console.log("trainingCategories isArray:", Array.isArray(trainingCategories));
        console.log("trainingCategories length:", trainingCategories?.length);
        console.log("=== END FINAL-YEAR TRAINING CATEGORIES DEBUG ===");

        // Process training categories for Final-Year
        let processedTrainingCategories = [];
        
        if (trainingCategories && Array.isArray(trainingCategories)) {
            processedTrainingCategories = trainingCategories
                .filter(cat => cat && typeof cat === 'string' && cat.trim().length > 0)
                .map(cat => cat.trim());
        }

        // ENHANCED: Process top 5 development areas for Final-Year
        let processedTopDevAreas = [];
        
        console.log("=== FINAL-YEAR TOP 5 DEVELOPMENT AREAS PROCESSING ===");
        
        if (topDevAreas !== null && topDevAreas !== undefined) {
            if (Array.isArray(topDevAreas)) {
                console.log("✅ Processing Final-Year topDevAreas as array with", topDevAreas.length, "items");
                
                processedTopDevAreas = topDevAreas
                    .filter(area => area && typeof area === 'object')
                    .map((area, index) => {
                        console.log(`Processing Final-Year development area ${index}:`, area);
                        
                        // Validate required fields
                        if (!area.type || !area.name || typeof area.averageRating !== 'number') {
                            console.warn(`  ❌ Invalid Final-Year development area ${index}:`, area);
                            return null;
                        }
                        
                        const processedArea = {
                            rank: area.rank || (index + 1),
                            type: area.type, // 'objective' or 'skill'
                            name: area.name.toString().trim(),
                            averageRating: parseFloat(area.averageRating),
                            quarterRatings: area.quarterRatings || {}
                        };
                        
                        // Add type-specific fields
                        if (area.type === 'objective') {
                            if (area.objectiveId) processedArea.objectiveId = area.objectiveId;
                            if (area.kpi) processedArea.kpi = area.kpi.toString().trim();
                        } else if (area.type === 'skill') {
                            if (area.skillId) processedArea.skillId = area.skillId;
                            if (area.skillType) processedArea.skillType = area.skillType.toString().trim();
                        }
                        
                        console.log(`  ✅ Processed Final-Year development area ${index}:`, processedArea);
                        return processedArea;
                    })
                    .filter(area => area !== null)
                    .slice(0, 5); // Ensure max 5 items
                    
                console.log("✅ Final processed Final-Year topDevAreas:", processedTopDevAreas);
            } else if (typeof topDevAreas === 'string') {
                console.log("Processing Final-Year topDevAreas as string, attempting JSON parse");
                try {
                    const parsed = JSON.parse(topDevAreas);
                    if (Array.isArray(parsed)) {
                        processedTopDevAreas = parsed.slice(0, 5);
                        console.log("✅ Parsed Final-Year topDevAreas from JSON string:", processedTopDevAreas);
                    }
                } catch (e) {
                    console.warn("Failed to parse Final-Year topDevAreas JSON string:", e);
                    processedTopDevAreas = [];
                }
            } else {
                console.log("❌ Unexpected type for Final-Year topDevAreas:", typeof topDevAreas);
                processedTopDevAreas = [];
            }
        } else {
            console.log("Final-Year topDevAreas is null/undefined");
            processedTopDevAreas = [];
        }

        console.log("=== FINAL PROCESSED FINAL-YEAR TOP 5 DEVELOPMENT AREAS ===");
        console.log("Final processedTopDevAreas:", processedTopDevAreas);
        console.log("Length:", processedTopDevAreas.length);
        console.log("Type:", typeof processedTopDevAreas);
        console.log("Is array:", Array.isArray(processedTopDevAreas));
        console.log("JSON for database:", JSON.stringify(processedTopDevAreas));
        console.log("=== END FINAL-YEAR TOP 5 DEVELOPMENT AREAS PROCESSING ===");

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

        console.log("=== FINAL-YEAR CLEANED FINAL DATA ===");
        console.log("Final-Year processed data summary:", {
            userId,
            topDevAreasCount: processedTopDevAreas.length,
            trainingCategoriesCount: processedTrainingCategories.length,
            year: currentYear
        });
        console.log("CRITICAL - Final-Year topDevAreas for DB:", processedTopDevAreas);
        console.log("CRITICAL - Final-Year trainingCategories for DB:", processedTrainingCategories);
        console.log("=== END FINAL-YEAR CLEANED FINAL DATA ===");

        // Check if there's already an entry for this user
        console.log("Checking for existing Final-Year record...");
        const { data: existingRecord, error: checkError } = await supabase
            .from("finalyearidps")
            .select("finalyearidpId")
            .eq("userId", userId)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error("Error checking for existing finalyearidp:", checkError);
            return res.status(500).json({ success: false, message: "Error checking for existing record" });
        }

        console.log("Existing Final-Year record check result:", existingRecord);

        // Prepare data for database insertion - ENHANCED with topDevAreas
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
            trainingCategories: processedTrainingCategories, // JSONB array
            topDevAreas: processedTopDevAreas, // ENHANCED: JSONB array of top 5 development areas
            trainingRemarks: trainingRemarks || null,
            year: currentYear
        };

        console.log("=== FINAL-YEAR DATA TO SAVE TO DATABASE ===");
        console.log("Final-Year data structure to save:");
        console.log("- topDevAreas value:", dataToSave.topDevAreas);
        console.log("- topDevAreas type:", typeof dataToSave.topDevAreas);
        console.log("- topDevAreas isArray:", Array.isArray(dataToSave.topDevAreas));
        console.log("- topDevAreas length:", dataToSave.topDevAreas.length);
        console.log("- trainingCategories length:", dataToSave.trainingCategories.length);
        console.log("=== END FINAL-YEAR DATA TO SAVE ===");

        let result;

        if (existingRecord) {
            // Update existing record
            console.log("Updating existing finalyearidp record:", existingRecord.finalyearidpId);
            
            const { data, error } = await supabase
                .from("finalyearidps")
                .update(dataToSave)
                .eq("finalyearidpId", existingRecord.finalyearidpId)
                .select();

            if (error) {
                console.error("❌ Error updating finalyearidp:", error);
                console.error("Error details:", JSON.stringify(error, null, 2));
                console.error("Data that failed to save:", JSON.stringify(dataToSave, null, 2));
                return res.status(500).json({ 
                    success: false, 
                    message: `Database update error: ${error.message}`,
                    errorDetails: error
                });
            }
            
            result = data;
            console.log("✅ Final-Year Update successful. Result:", result);
        } else {
            // Create new record
            console.log("Creating new finalyearidp record for userId:", userId);
            
            const { data, error } = await supabase
                .from("finalyearidps")
                .insert({
                    userId,
                    ...dataToSave
                })
                .select();

            if (error) {
                console.error("❌ Error inserting finalyearidp:", error);
                console.error("Error details:", JSON.stringify(error, null, 2));
                console.error("Data that failed to save:", JSON.stringify({ userId, ...dataToSave }, null, 2));
                return res.status(500).json({ 
                    success: false, 
                    message: `Database insert error: ${error.message}`,
                    errorDetails: error
                });
            }
            
            result = data;
            console.log("✅ Final-Year Insert successful. Result:", result);
        }

        // Verify the saved data - ENHANCED
        console.log("=== FINAL-YEAR VERIFICATION: CHECKING SAVED DATA ===");
        const { data: verificationData, error: verificationError } = await supabase
            .from("finalyearidps")
            .select("trainingCategories, topDevAreas")
            .eq("userId", userId)
            .single();

        if (verificationError) {
            console.warn("⚠️ Could not verify Final-Year saved data:", verificationError);
        } else {
            console.log("✅ VERIFICATION: Final-Year saved trainingCategories in database:", verificationData.trainingCategories);
            console.log("✅ VERIFICATION: Final-Year saved topDevAreas in database:", verificationData.topDevAreas);
            console.log("✅ VERIFICATION: Final-Year topDevAreas type:", typeof verificationData.topDevAreas);
            console.log("✅ VERIFICATION: Final-Year topDevAreas isArray:", Array.isArray(verificationData.topDevAreas));
        }
        console.log("=== END FINAL-YEAR VERIFICATION ===");

        console.log("=== FINAL-YEAR OPERATION COMPLETED SUCCESSFULLY ===");
        console.log("✅ Final-Year IDP saved successfully with categories:", processedTrainingCategories);
        console.log("✅ Final-Year IDP saved successfully with top 5 development areas:", processedTopDevAreas);
        console.log("✅ Total Final-Year categories saved:", processedTrainingCategories.length);
        console.log("✅ Total Final-Year development areas saved:", processedTopDevAreas.length);
        console.log("=== END FINAL-YEAR OPERATION ===");

        // If it's an API request (AJAX), return JSON
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(200).json({ 
                success: true, 
                message: "Final-Year IDP saved successfully",
                data: result,
                savedCategories: processedTrainingCategories,
                savedTopDevAreas: processedTopDevAreas, // ENHANCED
                totalCategories: processedTrainingCategories.length,
                totalTopDevAreas: processedTopDevAreas.length, // ENHANCED
                debug: {
                    originalTrainingCategories: trainingCategories,
                    processedTrainingCategories: processedTrainingCategories,
                    originalTopDevAreas: topDevAreas, // ENHANCED
                    processedTopDevAreas: processedTopDevAreas, // ENHANCED
                    verificationData: verificationData || null
                }
            });
        }

        // Otherwise, redirect to the user's records page with success message
        req.flash('success', 'Final-Year IDP submitted successfully!');
        return res.redirect(`/linemanager/records-performance-tracker/${userId}`);

    } catch (error) {
        console.error("=== ERROR IN ENHANCED saveFinalYearIDP ===");
        console.error("❌ Error:", error);
        console.error("❌ Error stack:", error.stack);
        console.error("❌ Error message:", error.message);
        console.error("❌ Error name:", error.name);
        console.error("=== END ERROR ===");
        
        // If it's an API request (AJAX), return JSON error
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ 
                success: false, 
                message: "An error occurred while saving the Final-Year IDP",
                error: error.message,
                debug: {
                    errorType: error.constructor.name,
                    errorMessage: error.message,
                    errorStack: error.stack
                }
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


getMidYearIDPViewData: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        console.log("=== getMidYearIDPViewData DEBUG ===");
        console.log('Fetching Mid-Year IDP view data for userId:', userId);

        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        // Get Mid-Year IDP data including all fields and trainingCategories JSONB field
        const { data: midyearData, error: midyearError } = await supabase
            .from("midyearidps")
            .select("*")
            .eq("userId", userId)
            .maybeSingle(); // Use maybeSingle to avoid error when no data exists

        if (midyearError && midyearError.code !== 'PGRST116') {
            console.error("Error fetching Mid-Year IDP:", midyearError);
            return res.status(500).json({ success: false, message: "Error fetching Mid-Year IDP data" });
        }

        console.log("Raw midyear data from database:", midyearData);

        let responseData = {
            exists: !!midyearData,
            midYearData: midyearData,
            trainingCategories: [],
            trainingRemarks: null
        };

        if (midyearData) {
            console.log("Processing midyear data for view...");
            console.log("Raw trainingCategories from DB:", midyearData.trainingCategories);
            console.log("Type of trainingCategories:", typeof midyearData.trainingCategories);
            
            // Extract training categories from JSONB field
            if (midyearData.trainingCategories) {
                try {
                    let categories = midyearData.trainingCategories;
                    
                    // Handle both parsed arrays and JSON strings
                    if (typeof categories === 'string') {
                        console.log("Parsing categories from JSON string");
                        categories = JSON.parse(categories);
                    }
                    
                    if (Array.isArray(categories)) {
                        console.log('Found training categories in JSONB:', categories);
                        responseData.trainingCategories = categories;
                    } else {
                        console.log('Training categories is not an array:', categories);
                        responseData.trainingCategories = [];
                    }
                } catch (parseError) {
                    console.error('Error parsing training categories:', parseError);
                    console.error('Raw value:', midyearData.trainingCategories);
                    responseData.trainingCategories = [];
                }
            }

            // Extract training remarks
            if (midyearData.trainingRemarks) {
                console.log('Found training remarks:', midyearData.trainingRemarks);
                responseData.trainingRemarks = midyearData.trainingRemarks;
            }

            // Add all other IDP fields to the response
            responseData.midYearData = {
                ...midyearData,
                // Ensure training categories are properly included
                trainingCategories: responseData.trainingCategories
            };
        }

        console.log('Final view response data structure:', {
            exists: responseData.exists,
            categoriesCount: responseData.trainingCategories.length,
            categories: responseData.trainingCategories,
            hasRemarks: !!responseData.trainingRemarks,
            hasAllFields: !!(midyearData?.profStrengths && midyearData?.leaderStrengths)
        });
        console.log("=== END getMidYearIDPViewData DEBUG ===");

        return res.status(200).json({
            success: true,
            data: responseData,
            debug: {
                dataExists: !!midyearData,
                rawTrainingCategories: midyearData?.trainingCategories,
                processedCategories: responseData.trainingCategories,
                categoriesType: typeof midyearData?.trainingCategories
            }
        });

    } catch (error) {
        console.error("=== ERROR in getMidYearIDPViewData ===");
        console.error("Error:", error);
        console.error("Error stack:", error.stack);
        console.error("=== END ERROR ===");
        
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while fetching Mid-Year IDP view data",
            error: error.message 
        });
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

        // Then, get the Final-Year IDP data INCLUDING training categories and top dev areas
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
        };

        // ENHANCED: Include training categories and top dev areas in the finalYearData
        if (finalYearData) {
            console.log('Final-Year IDP data found with enhanced features:', {
                hasTrainingCategories: !!finalYearData.trainingCategories,
                categoriesCount: finalYearData.trainingCategories ? finalYearData.trainingCategories.length : 0,
                hasTrainingRemarks: !!finalYearData.trainingRemarks,
                hasTopDevAreas: !!finalYearData.topDevAreas,
                topDevAreasCount: finalYearData.topDevAreas ? finalYearData.topDevAreas.length : 0
            });
        }

        // Determine view state - whether to show form or view-only mode
        const viewState = {
            viewOnlyStatus: {
                finalyearidp: !!finalYearData // true if finalYearData exists, false otherwise
            },
            finalYearData // Pass the complete data including training categories and top dev areas for view-only mode
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

        // Then, get the Final-Year IDP data INCLUDING training categories and top dev areas
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
        };

        // ENHANCED: Include training categories and top dev areas in the finalYearData
        if (finalYearData) {
            console.log('Final-Year IDP data found with enhanced features:', {
                hasTrainingCategories: !!finalYearData.trainingCategories,
                categoriesCount: finalYearData.trainingCategories ? finalYearData.trainingCategories.length : 0,
                hasTrainingRemarks: !!finalYearData.trainingRemarks,
                hasTopDevAreas: !!finalYearData.topDevAreas,
                topDevAreasCount: finalYearData.topDevAreas ? finalYearData.topDevAreas.length : 0
            });
        }

        // Determine view state - whether to show form or view-only mode
        const viewState = {
            viewOnlyStatus: {
                finalyearidp: !!finalYearData // true if finalYearData exists, false otherwise
            },
            finalYearData // Pass the complete data including training categories and top dev areas for view-only mode
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

getFinalYearIDPWithTrainings: async function(req, res) {
    try {
        const userId = req.params.userId;
        
        console.log("=== getFinalYearIDPWithTrainings DEBUG ===");
        console.log('Fetching Final-Year IDP with training categories for userId:', userId);

        if (!userId) {
            return res.status(400).json({ success: false, message: "User ID is required" });
        }

        // Get Final-Year IDP data including trainingCategories and topDevAreas JSONB fields
        const { data: finalyearData, error: finalyearError } = await supabase
            .from("finalyearidps")
            .select("*")
            .eq("userId", userId)
            .single();

        if (finalyearError && finalyearError.code !== 'PGRST116') {
            console.error("Error fetching Final-Year IDP:", finalyearError);
            return res.status(500).json({ success: false, message: "Error fetching Final-Year IDP data" });
        }

        console.log("Raw finalyear data from database:", finalyearData);

        let responseData = {
            finalYearData: finalyearData,
            trainingCategories: [],
            trainingRemarks: null,
            topDevAreas: [] // ENHANCED: Include top development areas
        };

        if (finalyearData) {
            console.log("Processing finalyear data...");
            console.log("Raw trainingCategories from DB:", finalyearData.trainingCategories);
            console.log("Raw topDevAreas from DB:", finalyearData.topDevAreas);
            console.log("Type of trainingCategories:", typeof finalyearData.trainingCategories);
            console.log("Type of topDevAreas:", typeof finalyearData.topDevAreas);
            
            // ENHANCED: Extract training categories from JSONB field with debugging
            if (finalyearData.trainingCategories) {
                try {
                    // Parse if it's a string, or use directly if already parsed
                    let categories = finalyearData.trainingCategories;
                    
                    if (typeof categories === 'string') {
                        console.log("Parsing categories from JSON string");
                        categories = JSON.parse(categories);
                    }
                    
                    if (Array.isArray(categories)) {
                        console.log('Found Final-Year training categories in JSONB:', categories);
                        responseData.trainingCategories = categories;
                    } else {
                        console.log('Final-Year training categories is not an array:', categories);
                        responseData.trainingCategories = [];
                    }
                } catch (parseError) {
                    console.error('Error parsing Final-Year training categories:', parseError);
                    console.error('Raw value:', finalyearData.trainingCategories);
                    responseData.trainingCategories = [];
                }
            } else {
                console.log('No Final-Year training categories found in database');
            }

            // ENHANCED: Extract top development areas from JSONB field
            if (finalyearData.topDevAreas) {
                try {
                    let topDevAreas = finalyearData.topDevAreas;
                    
                    if (typeof topDevAreas === 'string') {
                        console.log("Parsing topDevAreas from JSON string");
                        topDevAreas = JSON.parse(topDevAreas);
                    }
                    
                    if (Array.isArray(topDevAreas)) {
                        console.log('Found Final-Year top development areas in JSONB:', topDevAreas);
                        responseData.topDevAreas = topDevAreas;
                    } else {
                        console.log('Final-Year top development areas is not an array:', topDevAreas);
                        responseData.topDevAreas = [];
                    }
                } catch (parseError) {
                    console.error('Error parsing Final-Year top development areas:', parseError);
                    console.error('Raw value:', finalyearData.topDevAreas);
                    responseData.topDevAreas = [];
                }
            } else {
                console.log('No Final-Year top development areas found in database');
            }

            // Extract training remarks
            if (finalyearData.trainingRemarks) {
                console.log('Found Final-Year training remarks:', finalyearData.trainingRemarks);
                responseData.trainingRemarks = finalyearData.trainingRemarks;
            }
        }

        console.log('Final Final-Year response data structure:', {
            categoriesCount: responseData.trainingCategories.length,
            categories: responseData.trainingCategories,
            topDevAreasCount: responseData.topDevAreas.length,
            topDevAreas: responseData.topDevAreas,
            hasRemarks: !!responseData.trainingRemarks
        });
        console.log("=== END getFinalYearIDPWithTrainings DEBUG ===");

        return res.status(200).json({
            success: true,
            data: responseData,
            debug: {
                rawTrainingCategories: finalyearData?.trainingCategories,
                rawTopDevAreas: finalyearData?.topDevAreas,
                processedCategories: responseData.trainingCategories,
                processedTopDevAreas: responseData.topDevAreas,
                categoriesType: typeof finalyearData?.trainingCategories,
                topDevAreasType: typeof finalyearData?.topDevAreas
            }
        });

    } catch (error) {
        console.error("=== ERROR in getFinalYearIDPWithTrainings ===");
        console.error("Error:", error);
        console.error("Error stack:", error.stack);
        console.error("=== END ERROR ===");
        
        return res.status(500).json({ 
            success: false, 
            message: "An error occurred while fetching Final-Year IDP data",
            error: error.message 
        });
    }
},

getFinalYearFeedbackAggregates: async function(req, res) {
    try {
        const userId = req.params.userId;
        const selectedYear = req.query.year || new Date().getFullYear();
        
        console.log(`Fetching Final-Year feedback aggregates (Q3-Q4 ONLY) for userId: ${userId}, year: ${selectedYear}`);
        
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
        
        // CRITICAL: Get ONLY Q3 and Q4 feedback records for Final-Year
        const { data: q3Feedback, error: q3Error } = await supabase
            .from('feedbacks_Q3')
            .select('feedbackq3_Id')
            .eq('userId', userId)
            .eq('jobId', jobId)
            .eq('year', selectedYear)
            .maybeSingle();
            
        const { data: q4Feedback, error: q4Error } = await supabase
            .from('feedbacks_Q4')
            .select('feedbackq4_Id')
            .eq('userId', userId)
            .eq('jobId', jobId)
            .eq('year', selectedYear)
            .maybeSingle();
            
        if ((q3Error && q3Error.code !== 'PGRST116') || (q4Error && q4Error.code !== 'PGRST116')) {
            console.error('Error fetching Q3-Q4 feedback records:', { q3Error, q4Error });
            return res.status(500).json({
                success: false,
                message: "Error retrieving Q3-Q4 feedback records."
            });
        }
        
        // Initialize aggregated data structures
        const objectiveAggregates = [];
        const skillAggregates = [];
        
        // CRITICAL: Process ONLY Q3 and Q4 feedback data for Final-Year
        const quarterData = [
            { quarter: 'Q3', feedbackId: q3Feedback?.feedbackq3_Id, idField: 'feedbackq3_Id' },
            { quarter: 'Q4', feedbackId: q4Feedback?.feedbackq4_Id, idField: 'feedbackq4_Id' }
        ];
        
        console.log('Processing Final-Year quarters:', quarterData.map(q => q.quarter));
        
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
        
        // Process each quarter's feedback (Q3 and Q4 only)
        for (const { quarter, feedbackId, idField } of quarterData) {
            if (!feedbackId) {
                console.log(`No ${quarter} feedback found, skipping...`);
                continue;
            }
            
            console.log(`Processing Final-Year ${quarter} feedback with ID: ${feedbackId}`);
            
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
        
        // ENHANCED: Categorize feedback into 5-tier rating groups for Final-Year
        const categorizedFeedback = {
            excellent: [], // 4.5-5 stars
            good: [], // 3.5-4.4 stars
            satisfactory: [], // 2.5-3.4 stars
            needsImprovement: [], // 1.5-2.4 stars
            critical: [] // 0-1.4 stars
        };
        
        // Combine objectives and skills for categorization
        const allFeedbackItems = [...objectiveAggregates, ...skillAggregates];
        
        console.log(`=== FINAL-YEAR CATEGORIZATION DEBUG ===`);
        console.log(`Total feedback items to categorize: ${allFeedbackItems.length}`);
        
        allFeedbackItems.forEach((item, index) => {
            console.log(`Item ${index}: ${item.type} - ${item.type === 'objective' ? item.objectiveDescrpt : item.jobReqSkillName} - Rating: ${item.averageRating}`);
            
            if (item.averageRating >= 4.5) {
                categorizedFeedback.excellent.push(item);
                console.log(`  → Categorized as EXCELLENT (${item.averageRating})`);
            } else if (item.averageRating >= 3.5) {
                categorizedFeedback.good.push(item);
                console.log(`  → Categorized as GOOD (${item.averageRating})`);
            } else if (item.averageRating >= 2.5) {
                categorizedFeedback.satisfactory.push(item);
                console.log(`  → Categorized as SATISFACTORY (${item.averageRating})`);
            } else if (item.averageRating >= 1.5) {
                categorizedFeedback.needsImprovement.push(item);
                console.log(`  → Categorized as NEEDS IMPROVEMENT (${item.averageRating})`);
            } else if (item.averageRating > 0) {
                categorizedFeedback.critical.push(item);
                console.log(`  → Categorized as CRITICAL (${item.averageRating})`);
            }
        });
        
        console.log('=== FINAL CATEGORIZATION RESULTS ===');
        console.log('Final-Year (Q3-Q4) categorized feedback summary:', {
            excellent: categorizedFeedback.excellent.length,
            good: categorizedFeedback.good.length,
            satisfactory: categorizedFeedback.satisfactory.length,
            needsImprovement: categorizedFeedback.needsImprovement.length,
            critical: categorizedFeedback.critical.length,
            totalProcessed: allFeedbackItems.length
        });
        
        // CRITICAL: Ensure all arrays exist even if empty
        Object.keys(categorizedFeedback).forEach(key => {
            if (!Array.isArray(categorizedFeedback[key])) {
                categorizedFeedback[key] = [];
            }
        });
        
        const responseData = {
            objectives: objectiveAggregates,
            skills: skillAggregates,
            categorizedFeedback: categorizedFeedback,
            meta: {
                userId: userId,
                jobId: jobId,
                year: selectedYear,
                quarters: ['Q3', 'Q4'], // CRITICAL: Only Q3-Q4 for Final-Year
                totalItems: allFeedbackItems.length,
                availableQuarters: quarterData.filter(q => q.feedbackId).map(q => q.quarter),
                debug: {
                    rawObjectives: objectiveAggregates.length,
                    rawSkills: skillAggregates.length,
                    categorizedBreakdown: {
                        excellent: categorizedFeedback.excellent.length,
                        good: categorizedFeedback.good.length,
                        satisfactory: categorizedFeedback.satisfactory.length,
                        needsImprovement: categorizedFeedback.needsImprovement.length,
                        critical: categorizedFeedback.critical.length
                    }
                }
            }
        };
        
        console.log('=== SENDING FINAL-YEAR RESPONSE ===');
        console.log('Response structure:', JSON.stringify(responseData.meta.debug, null, 2));
        console.log('=== END FINAL-YEAR RESPONSE ===');
        
        return res.status(200).json({
            success: true,
            message: "Final-Year feedback aggregates (Q3-Q4) retrieved successfully",
            data: responseData
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
// Add this to your controller for debugging
debugFinalYearAggregates: async function(req, res) {
    try {
        const userId = req.params.userId;
        const year = req.query.year || new Date().getFullYear();
        
        // Get the actual aggregates
        const aggregatesResponse = await this.getFinalYearFeedbackAggregates(req, res);
        
        return res.status(200).json({
            success: true,
            message: "Final-Year aggregates debug complete",
            data: aggregatesResponse
        });
    } catch (error) {
        console.error('Debug error:', error);
        return res.status(500).json({
            success: false,
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
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        // Get data from request
        const { 
            jobId, 
            performancePeriodYear,
            objectiveDescrpt = [], 
            objectiveKPI = [], 
            objectiveTarget = [], 
            objectiveUOM = [], 
            objectiveAssignedWeight = [] 
        } = req.body;

        console.log("Received data:", req.body); // Debug log

        // Validate required fields
        if (!jobId || !performancePeriodYear) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing required fields: jobId or performancePeriodYear" 
            });
        }

        // Validate objectives
        if (objectiveDescrpt.length === 0 || 
            objectiveDescrpt.length !== objectiveKPI.length ||
            objectiveDescrpt.length !== objectiveTarget.length ||
            objectiveDescrpt.length !== objectiveUOM.length ||
            objectiveDescrpt.length !== objectiveAssignedWeight.length) {
            return res.status(400).json({ success: false, message: "Invalid objectives data - arrays must have same length" });
        }

        // Calculate total weight (frontend should have validated this)
        const totalWeight = objectiveAssignedWeight.reduce((sum, weight) => {
            const numWeight = typeof weight === 'string' ? parseFloat(weight) : weight;
            return sum + numWeight;
        }, 0);
        
        if (Math.abs(totalWeight - 100) > 0.01) {
            return res.status(400).json({ 
                success: false, 
                message: `Total weight must be 100%. Received: ${totalWeight}%` 
            });
        }

        // Check if objective settings already exist for this user/year
        const { data: existingSettings } = await supabase
            .from("objectivesettings")
            .select("objectiveSettingsId")
            .eq("userId", userId)
            .eq("performancePeriodYear", performancePeriodYear)
            .single();

        let objectiveSettingsId;

        if (existingSettings) {
            // Update existing settings
            objectiveSettingsId = existingSettings.objectiveSettingsId;
            
            // Delete existing objectives
            await supabase
                .from("objectivesettings_objectives")
                .delete()
                .eq("objectiveSettingsId", objectiveSettingsId);
        } else {
            // Insert new objective settings
            const { data: objectiveSettingsData, error: objectiveSettingsError } = await supabase
                .from("objectivesettings")
                .insert({
                    userId,
                    jobId,
                    performancePeriodYear
                })
                .select("objectiveSettingsId")
                .single();

            if (objectiveSettingsError) {
                console.error("Error inserting objective settings:", objectiveSettingsError);
                throw objectiveSettingsError;
            }

            objectiveSettingsId = objectiveSettingsData.objectiveSettingsId;
        }

        // Prepare objectives data
        const objectives = objectiveDescrpt.map((desc, index) => ({
            objectiveSettingsId,
            objectiveDescrpt: desc,
            objectiveKPI: objectiveKPI[index],
            objectiveTarget: objectiveTarget[index],
            objectiveUOM: objectiveUOM[index],
            objectiveAssignedWeight: parseFloat(objectiveAssignedWeight[index]) / 100 // Convert to decimal
        }));

        console.log("Inserting objectives:", objectives); // Debug log

        // Insert objectives
        const { data: insertedObjectives, error: objectivesInsertError } = await supabase
            .from("objectivesettings_objectives")
            .insert(objectives)
            .select();

        if (objectivesInsertError) {
            console.error("Error inserting objectives:", objectivesInsertError);
            throw objectivesInsertError;
        }

        console.log("Successfully inserted objectives:", insertedObjectives); // Debug log

        // Return success response
        res.json({ 
            success: true,
            message: "Objectives saved successfully",
            redirectUrl: `/linemanager/records-performance-tracker/view/${userId}`,
            data: {
                objectiveSettingsId,
                objectivesCount: objectives.length
            }
        });

    } catch (error) {
        console.error("Error saving objective settings:", error);
        res.status(500).json({ 
            success: false, 
            message: error.message || "Failed to save objectives" 
        });
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

checkDepartmentResponseRate: async function (req, res) {
try {
        const { userId } = req.params;
        const { quarters } = req.query; // e.g., "Q1,Q2" or "Q3,Q4"
        const year = req.query.year || new Date().getFullYear();
        
        console.log(`[DEPT VALIDATION] Checking for user ${userId}, quarters: ${quarters}, year: ${year}`);
        
        // Get user's department with department name
        const { data: userData, error: userError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId, 
                firstName, 
                lastName, 
                userId,
                departments!inner (deptName)
            `)
            .eq('userId', userId)
            .single();
            
        if (userError || !userData) {
            console.error('[DEPT VALIDATION] User lookup error:', userError);
            return res.status(404).json({
                success: false,
                message: 'User not found',
                error: userError?.message
            });
        }
        
        const departmentId = userData.departmentId;
        const departmentName = userData.departments?.deptName || 'Unknown Department';
        
        console.log(`[DEPT VALIDATION] User ${userId} belongs to department ${departmentId} (${departmentName})`);
        
        // Get all active staff in the same department
        const { data: departmentStaff, error: deptError } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName,
                useraccounts!inner (userIsDisabled)
            `)
            .eq('departmentId', departmentId)
            .eq('useraccounts.userIsDisabled', false);
            
        if (deptError) {
            console.error('[DEPT VALIDATION] Department staff lookup error:', deptError);
            return res.status(500).json({
                success: false,
                message: 'Error fetching department staff',
                error: deptError.message
            });
        }
        
        const totalStaff = departmentStaff?.length || 0;
        const quarterList = quarters.split(',').map(q => q.trim());
        
        console.log(`[DEPT VALIDATION] Found ${totalStaff} active staff members in department ${departmentName}`);
        
        let departmentResponseStats = {};
        
        // Check each quarter
        for (const quarter of quarterList) {
            console.log(`[DEPT VALIDATION] Checking ${quarter} responses...`);
            
            const feedbackTable = `feedbacks_${quarter}`;
            const feedbackIdField = `feedbackq${quarter.replace('Q', '')}_Id`;
            
            const departmentUserIds = departmentStaff.map(staff => staff.userId);
            
            // Get all feedback records for this quarter, year, and department users
            const { data: feedbackRecords, error: feedbackError } = await supabase
                .from(feedbackTable)
                .select(`${feedbackIdField}, userId, quarter, year`)
                .in('userId', departmentUserIds)
                .eq('year', year)
                .eq('quarter', quarter);
                
            if (feedbackError) {
                console.error(`[DEPT VALIDATION] Error fetching ${quarter} feedback records:`, feedbackError);
                // Don't continue, but don't fail completely - set empty stats
                departmentResponseStats[quarter] = {
                    staffWithResponses: 0,
                    totalStaff: totalStaff,
                    responseRate: 0,
                    isComplete: false,
                    error: feedbackError.message
                };
                continue;
            }
            
            console.log(`[DEPT VALIDATION] Found ${feedbackRecords?.length || 0} feedback records for ${quarter}`);
            
            let staffWithResponses = 0;
            
            if (feedbackRecords && feedbackRecords.length > 0) {
                // Check each feedback record for responses
                for (const record of feedbackRecords) {
                    const { data: responses, error: responseError } = await supabase
                        .from('feedbacks_answers')
                        .select('reviewerUserId')
                        .eq(feedbackIdField, record[feedbackIdField])
                        .not('reviewerUserId', 'is', null)
                        .limit(1); // Just check if at least one exists
                        
                    if (!responseError && responses && responses.length > 0) {
                        staffWithResponses++;
                    }
                }
            }
            
            const responseRate = totalStaff > 0 ? Math.round((staffWithResponses / totalStaff) * 100) : 0;
            const isComplete = responseRate === 100;
            
            console.log(`[DEPT VALIDATION] ${quarter}: ${staffWithResponses}/${totalStaff} (${responseRate}%) - ${isComplete ? 'COMPLETE' : 'INCOMPLETE'}`);
            
            departmentResponseStats[quarter] = {
                staffWithResponses,
                totalStaff,
                responseRate,
                isComplete
            };
        }
        
        // Check if all required quarters are complete
        const allQuartersComplete = quarterList.every(quarter => 
            departmentResponseStats[quarter]?.isComplete === true
        );
        
        const incompleteQuarters = quarterList.filter(quarter => 
            !departmentResponseStats[quarter]?.isComplete
        );
        
        const blockingMessage = allQuartersComplete ? null : 
            `Department feedback incomplete for ${incompleteQuarters.join(' and ')}. All ${totalStaff} department members must complete their feedback questionnaires.`;
        
        console.log(`[DEPT VALIDATION] Final result: ${allQuartersComplete ? 'CAN PROCEED' : 'BLOCKED'}`);
        
        const result = {
            success: true,
            data: {
                departmentId,
                departmentName,
                totalStaff,
                responseStats: departmentResponseStats,
                allQuartersComplete,
                canProceed: allQuartersComplete,
                blockingMessage,
                quarters: quarterList,
                year: parseInt(year)
            }
        };
        
        console.log('[DEPT VALIDATION] Sending response:', JSON.stringify(result, null, 2));
        res.json(result);
        
    } catch (error) {
        console.error('[DEPT VALIDATION] Server error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error checking department response rate',
            error: error.message
        });
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
        
        return res.render('staffpages/linemanager_pages/linemanager-quarterlyfeedbackquestionnaire.ejs', {
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
generatePDFReport: async function(data) {
        return new Promise((resolve, reject) => {
            try {
                console.log('Starting PDF generation...');
                
                const doc = new PDFDocument({
                    margin: 50,
                    size: 'A4',
                    info: {
                        Title: `Quarterly 360 Feedback Report - ${data.employee.firstName} ${data.employee.lastName}`,
                        Author: 'Performance Management System',
                        Subject: `${data.quarter} ${data.year} Performance Report`,
                        Creator: 'PDF Generator'
                    }
                });
                
                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    try {
                        const pdfBuffer = Buffer.concat(buffers);
                        console.log('PDF generation completed, buffer size:', pdfBuffer.length);
                        resolve(pdfBuffer);
                    } catch (bufferError) {
                        console.error('Error concatenating PDF buffers:', bufferError);
                        reject(bufferError);
                    }
                });
                
                doc.on('error', (error) => {
                    console.error('PDF document error:', error);
                    reject(error);
                });
                
                try {
                    // PDF Content Generation
                    this.addPDFHeader(doc, data);
                    this.addEmployeeInformation(doc, data);
                    this.addRespondentSummary(doc, data);
                    this.addObjectivesAssessment(doc, data);
                    this.addSkillsAssessment(doc, data);
                    this.addPerformanceSummary(doc, data);
                    this.addPDFFooter(doc, data);
                    
                    console.log('PDF content added successfully');
                    doc.end();
                    
                } catch (contentError) {
                    console.error('Error adding PDF content:', contentError);
                    reject(contentError);
                }
                
            } catch (error) {
                console.error('Error in PDF generation setup:', error);
                reject(error);
            }
        });
    },
addPDFHeader: function(doc, data) {
        try {
            doc.fontSize(20)
               .font('Helvetica-Bold')
               .fillColor('#2c3e50')
               .text('Performance Management System', 50, 50, {
                   align: 'center',
                   width: doc.page.width - 100
               });
            
            doc.fontSize(16)
               .fillColor('#34495e')
               .text('Quarterly 360° Feedback Report', 50, 80, {
                   align: 'center',
                   width: doc.page.width - 100
               });
            
            doc.moveTo(50, 110)
               .lineTo(doc.page.width - 50, 110)
               .strokeColor('#bdc3c7')
               .lineWidth(2)
               .stroke();
            
            doc.moveDown(3);
            console.log('PDF header added successfully');
            
        } catch (error) {
            console.error('Error adding PDF header:', error);
            throw error;
        }
    },
 addEmployeeInformation: function(doc, data) {
        try {
            const startY = doc.y;
            
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#2c3e50')
               .text('Employee Information', 50, startY);
            
            const tableTop = startY + 30;
            const leftCol = 50;
            const rightCol = 250;
            const tableWidth = 450;
            const tableHeight = 150;
            
            doc.rect(leftCol, tableTop, tableWidth, tableHeight)
               .strokeColor('#34495e')
               .lineWidth(1)
               .stroke();
            
            const rowHeight = 25;
            const rows = [
                ['Employee Name:', `${data.employee.firstName} ${data.employee.lastName}`],
                ['Position:', data.employee.jobpositions?.jobTitle || 'N/A'],
                ['Department:', data.employee.departments?.deptName || 'N/A'],
                ['Email:', data.employee.useraccounts?.userEmail || 'N/A'],
                ['Line Manager:', data.lineManager ? `${data.lineManager.firstName} ${data.lineManager.lastName}` : 'N/A'],
                ['Reporting Period:', `${this.formatDate(data.reportingPeriod.start)} - ${this.formatDate(data.reportingPeriod.end)}`]
            ];
            
            rows.forEach((row, index) => {
                const y = tableTop + (index * rowHeight);
                
                if (index > 0) {
                    doc.moveTo(leftCol, y)
                       .lineTo(leftCol + tableWidth, y)
                       .strokeColor('#bdc3c7')
                       .lineWidth(0.5)
                       .stroke();
                }
                
                if (index === 0) {
                    doc.moveTo(rightCol, tableTop)
                       .lineTo(rightCol, tableTop + tableHeight)
                       .strokeColor('#bdc3c7')
                       .lineWidth(0.5)
                       .stroke();
                }
                
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .fillColor('#2c3e50')
                   .text(row[0], leftCol + 10, y + 8, { width: rightCol - leftCol - 20 });
                
                doc.font('Helvetica')
                   .fillColor('#34495e')
                   .text(row[1], rightCol + 10, y + 8, { width: tableWidth - (rightCol - leftCol) - 20 });
            });
            
            doc.y = tableTop + tableHeight + 20;
            console.log('Employee information section added successfully');
            
        } catch (error) {
            console.error('Error adding employee information:', error);
            throw error;
        }
    },
 addRespondentSummary: function(doc, data) {
        try {
            const startY = doc.y;
            
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#2c3e50')
               .text('Respondent Summary', 50, startY);
            
            doc.moveDown(1);
            
            const boxTop = doc.y;
            const boxHeight = 60;
            
            doc.rect(50, boxTop, doc.page.width - 100, boxHeight)
               .fillColor('#ecf0f1')
               .fill()
               .rect(50, boxTop, doc.page.width - 100, boxHeight)
               .strokeColor('#bdc3c7')
               .lineWidth(1)
               .stroke();
            
            doc.fontSize(12)
               .font('Helvetica')
               .fillColor('#2c3e50')
               .text(`Q1: ${data.respondentCounts.Q1} respondents`, 70, boxTop + 15)
               .text(`Q2: ${data.respondentCounts.Q2} respondents`, 200, boxTop + 15)
               .text(`Q3: ${data.respondentCounts.Q3} respondents`, 330, boxTop + 15)
               .text(`Q4: ${data.respondentCounts.Q4} respondents`, 460, boxTop + 15);
            
            doc.fontSize(13)
               .font('Helvetica-Bold')
               .fillColor('#e74c3c')
               .text(`Total Unique Respondents: ${data.respondentCounts.total}`, 70, boxTop + 35);
            
            doc.y = boxTop + boxHeight + 20;
            console.log('Respondent summary added successfully');
            
        } catch (error) {
            console.error('Error adding respondent summary:', error);
            throw error;
        }
    },

addObjectivesAssessment: function(doc, data) {
        try {
            if (doc.y > 600) {
                doc.addPage();
                doc.y = 50;
            }
            
            const startY = doc.y;
            
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#2c3e50')
               .text('Objectives Assessment', 50, startY);
            
            doc.moveDown(1);
            
            if (!data.objectives || data.objectives.length === 0) {
                doc.fontSize(11)
                   .font('Helvetica')
                   .fillColor('#7f8c8d')
                   .text('No objectives data available for this reporting period.', 70, doc.y);
                doc.moveDown(2);
                console.log('No objectives data to display');
                return;
            }
            
            // Simple table for objectives
            data.objectives.forEach((objective, index) => {
                if (doc.y > 700) {
                    doc.addPage();
                    doc.y = 50;
                }
                
                doc.fontSize(11)
                   .font('Helvetica-Bold')
                   .fillColor('#2c3e50')
                   .text(`Objective ${index + 1}: ${this.truncateText(objective.objective || 'N/A', 60)}`, 70, doc.y);
                
                doc.moveDown(0.3);
                
                doc.font('Helvetica')
                   .text(`KPI: ${objective.kpi || 'N/A'}`, 70, doc.y)
                   .text(`Target: ${objective.target || 'N/A'}`, 250, doc.y)
                   .text(`Weight: ${(objective.assignedWeight * 100).toFixed(1)}%`, 350, doc.y)
                   .text(`Score: ${objective.weightedScore}`, 450, doc.y);
                
                doc.moveDown(0.3);
                
                doc.text(`Average Rating: ${objective.averageRating}/5.0`, 70, doc.y);
                
                doc.moveDown(0.8);
            });
            
            doc.moveDown(1);
            console.log('Objectives assessment added successfully');
            
        } catch (error) {
            console.error('Error adding objectives assessment:', error);
            throw error;
        }
    },

    addSkillsAssessment: function(doc, data) {
        try {
            if (doc.y > 650) {
                doc.addPage();
                doc.y = 50;
            }
            
            // Hard Skills Section
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#e67e22')
               .text('Hard Skills Assessment', 50, doc.y);
            
            doc.moveDown(0.5);
            
            if (data.skills.hardSkills.length > 0) {
                data.skills.hardSkills.forEach((skill) => {
                    doc.fontSize(11)
                       .font('Helvetica')
                       .fillColor('#2c3e50')
                       .text(`${this.truncateText(skill.skillName, 40)}: ${skill.averageRating}/5.0`, 70, doc.y);
                    doc.moveDown(0.3);
                });
            } else {
                doc.fontSize(11)
                   .font('Helvetica')
                   .fillColor('#7f8c8d')
                   .text('No hard skills data available.', 70, doc.y);
            }
            
            doc.moveDown(0.8);
            
            // Soft Skills Section
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#9b59b6')
               .text('Soft Skills Assessment', 50, doc.y);
            
            doc.moveDown(0.5);
            
            if (data.skills.softSkills.length > 0) {
                data.skills.softSkills.forEach((skill) => {
                    doc.fontSize(11)
                       .font('Helvetica')
                       .fillColor('#2c3e50')
                       .text(`${this.truncateText(skill.skillName, 40)}: ${skill.averageRating}/5.0`, 70, doc.y);
                    doc.moveDown(0.3);
                });
            } else {
                doc.fontSize(11)
                   .font('Helvetica')
                   .fillColor('#7f8c8d')
                   .text('No soft skills data available.', 70, doc.y);
            }
            
            doc.moveDown(1);
            console.log('Skills assessment added successfully');
            
        } catch (error) {
            console.error('Error adding skills assessment:', error);
            throw error;
        }
    },
addPerformanceSummary: function(doc, data) {
        try {
            if (doc.y > 600) {
                doc.addPage();
                doc.y = 50;
            }
            
            doc.fontSize(14)
               .font('Helvetica-Bold')
               .fillColor('#2c3e50')
               .text('Performance Summary', 50, doc.y);
            
            doc.moveDown(1);
            
            const summary = data.summary;
            const boxTop = doc.y;
            const boxHeight = 120;
            
            doc.rect(50, boxTop, doc.page.width - 100, boxHeight)
               .fillColor('#f8f9fa')
               .fill()
               .rect(50, boxTop, doc.page.width - 100, boxHeight)
               .strokeColor('#34495e')
               .lineWidth(1)
               .stroke();
            
            doc.fontSize(12)
               .font('Helvetica')
               .fillColor('#2c3e50')
               .text(`Objectives Evaluated: ${summary.objectivesCount}`, 70, boxTop + 15)
               .text(`Average Objective Rating: ${summary.averageObjectiveRating}/5.0`, 300, boxTop + 15)
               
               .text(`Hard Skills Evaluated: ${summary.hardSkillsCount}`, 70, boxTop + 35)
               .text(`Average Hard Skills Rating: ${summary.averageHardSkillRating}/5.0`, 300, boxTop + 35)
               
               .text(`Soft Skills Evaluated: ${summary.softSkillsCount}`, 70, boxTop + 55)
               .text(`Average Soft Skills Rating: ${summary.averageSoftSkillRating}/5.0`, 300, boxTop + 55);
            
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .fillColor('#e74c3c')
               .text(`Overall Performance Score: ${summary.overallPerformanceScore}/5.0`, 70, boxTop + 85);
            
            doc.y = boxTop + boxHeight + 20;
            console.log('Performance summary added successfully');
            
        } catch (error) {
            console.error('Error adding performance summary:', error);
            throw error;
        }
    },

    addPDFFooter: function(doc, data) {
        try {
            const footerY = doc.page.height - 100;
            
            doc.moveTo(50, footerY)
               .lineTo(doc.page.width - 50, footerY)
               .strokeColor('#bdc3c7')
               .lineWidth(1)
               .stroke();
            
            doc.fontSize(9)
               .font('Helvetica')
               .fillColor('#7f8c8d')
               .text(`Generated on: ${new Date().toLocaleString()}`, 50, footerY + 10)
               .text(`Report Period: ${data.quarter} ${data.year}`, 50, footerY + 25)
               .text('Performance Management System', doc.page.width - 200, footerY + 10, {
                   align: 'right',
                   width: 150
               });
            
            console.log('PDF footer added successfully');
            
        } catch (error) {
            console.error('Error adding PDF footer:', error);
            throw error;
        }
    },
// Helper function to add skills section
addSkillsSection: function(doc, title, skills, color) {
    try {
        doc.fontSize(14)
           .font('Helvetica-Bold')
           .fillColor(color)
           .text(title, 50, doc.y);
        
        doc.moveDown(1);
        
        if (!skills || skills.length === 0) {
            doc.fontSize(11)
               .font('Helvetica')
               .fillColor('#7f8c8d')
               .text(`No ${title.toLowerCase()} data available.`, 70, doc.y);
            doc.moveDown(1);
            return;
        }
        
        // Create a grid layout for skills
        const skillsPerRow = 2;
        const skillWidth = 200;
        const skillHeight = 30;
        
        skills.forEach((skill, index) => {
            if (doc.y > 700) {
                doc.addPage();
                doc.y = 50;
            }
            
            const row = Math.floor(index / skillsPerRow);
            const col = index % skillsPerRow;
            const x = 70 + (col * 250);
            const y = doc.y + (row * skillHeight) - (Math.floor(index / skillsPerRow) * skillHeight);
            
            if (col === 0) {
                doc.y += skillHeight;
            }
            
            // Skill name and rating
            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#2c3e50')
               .text(`${this.truncateText(skill.skillName, 25)}:`, x, y + 8);
            
            doc.font('Helvetica-Bold')
               .fillColor(color)
               .text(`${skill.averageRating}/5.0`, x + 140, y + 8);
        });
        
        // Adjust y position after the grid
        const totalRows = Math.ceil(skills.length / skillsPerRow);
        if (skills.length % skillsPerRow !== 0) {
            doc.y += skillHeight * (totalRows - Math.floor(skills.length / skillsPerRow));
        }
        
    } catch (error) {
        console.error('Error adding skills section:', error);
        throw error;
    }
},
 formatDate: function(dateString) {
        if (!dateString) return 'N/A';
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            console.error('Date formatting error:', error);
            return 'Invalid Date';
        }
    },

    truncateText: function(text, maxLength) {
        if (!text || typeof text !== 'string') return 'N/A';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
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
generateQuarterlyFeedbackReport: async function(req, res) {
    try {
        const { employeeId: userId } = req.query;
        const { quarter, year = new Date().getFullYear()} = req.query;
        
        console.log(`🎯 Generating quarterly feedback report for user ${userId}, ${quarter} ${year}`);
        
        // Validation
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required."
            });
        }
        
        if (!quarter) {
            return res.status(400).json({
                success: false,
                message: "Quarter parameter is required."
            });
        }
        
        if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) {
            return res.status(400).json({
                success: false,
                message: "Quarter must be Q1, Q2, Q3, or Q4."
            });
        }
        
        const yearNum = parseInt(year);
        if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2030) {
            return res.status(400).json({
                success: false,
                message: "Invalid year provided."
            });
        }
        
        // Get employee data
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
        
        // Get line manager data
        let lineManagerData = null;
        if (req.session?.user?.userId) {
            const { data: lmData } = await supabase
                .from('staffaccounts')
                .select(`
                    firstName,
                    lastName,
                    jobpositions!inner (jobTitle)
                `)
                .eq('userId', req.session.user.userId)
                .single();
            
            if (lmData) {
                lineManagerData = lmData;
            }
        }
        
        // Get feedback data using helper functions
        const feedbackData = await lineManagerController.getQuarterlyFeedbackData(userId, quarter, yearNum);
        
        if (!feedbackData.success) {
            return res.status(404).json({
                success: false,
                message: `No ${quarter} feedback found for ${year}.`
            });
        }
        
        // Get respondent counts
        const respondentCounts = await lineManagerController.getRespondentCounts(userId, yearNum);
        
        // Prepare report data
        const reportData = {
            employee: {
                ...employeeData,
                fullName: `${employeeData.firstName} ${employeeData.lastName}`
            },
            lineManager: lineManagerData ? {
                ...lineManagerData,
                fullName: `${lineManagerData.firstName} ${lineManagerData.lastName}`
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
        
        // Always return JSON data (PDF generation handled by frontend)
        return res.json({
            success: true,
            data: reportData,
            filename: `Quarterly_Feedback_Report_${employeeData.firstName}_${employeeData.lastName}_${quarter}_${year}.pdf`
        });
        
    } catch (error) {
        console.error('❌ Error in generateQuarterlyFeedbackReport:', error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while generating the report.",
            error: error.message
        });
    }
},

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
            return { totalEmployees: 0, employeesWithFeedback: 0, completedQuarters: [], currentYear: new Date().getFullYear() };
        }

        console.log('📊 Found employees in department:', employees?.length || 0);
        
        const employeeIds = employees?.map(emp => emp.userId) || [];
        const currentYear = new Date().getFullYear();
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        
        let totalEmployeesWithFeedback = new Set();
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
                    
                    quarterFeedback.forEach(fb => totalEmployeesWithFeedback.add(fb.userId));
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
        return { totalEmployees: 0, employeesWithFeedback: 0, completedQuarters: [], currentYear: new Date().getFullYear() };
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
            console.log(`❌ Table feedbacks_${quarter} error:`, tableError.message);
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
        const feedbackIdField = `feedback${quarter.toLowerCase()}_Id`;

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

getObjectivesReportData: async function(feedbackId, feedbackIdField) {
    try {
        console.log('Getting objectives data for feedbackId:', feedbackId, 'field:', feedbackIdField);
        
        // First get the objectives questions for this feedback
        const { data: objectiveQuestions, error: questionsError } = await supabase
            .from('feedbacks_questions-objectives')
            .select(`
                feedback_qObjectivesId,
                objectiveId,
                objectiveQualiQuestion,
                objectivesettings_objectives!inner(
                    objectiveDescrpt,
                    objectiveKPI,
                    objectiveTarget,
                    objectiveUOM,
                    objectiveAssignedWeight
                )
            `)
            .eq(feedbackIdField, feedbackId);

        if (questionsError) {
            console.error('Error fetching objective questions:', questionsError);
            return [];
        }

        if (!objectiveQuestions || objectiveQuestions.length === 0) {
            console.log('No objective questions found');
            return [];
        }

        console.log('Found objective questions:', objectiveQuestions.length);

        // Now get the answers for these questions
        const processedObjectives = [];
        
        for (const question of objectiveQuestions) {
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-objectives')
                .select(`
                    objectiveQuantInput,
                    objectiveQualInput
                `)
                .eq('feedback_qObjectivesId', question.feedback_qObjectivesId);

            if (answersError) {
                console.error('Error fetching answers for objective:', question.objectiveId, answersError);
                continue;
            }

            // Calculate average rating
            const ratings = answers?.map(a => a.objectiveQuantInput).filter(r => r && r > 0) || [];
            const averageRating = ratings.length > 0 
                ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length 
                : 0;

            const objective = question.objectivesettings_objectives;
            const assignedWeight = objective.objectiveAssignedWeight || 0;
            const weightedScore = (averageRating * (assignedWeight / 100));

            processedObjectives.push({
                objectiveId: question.objectiveId,
                objective: objective.objectiveDescrpt || 'Unknown Objective',
                kpi: objective.objectiveKPI || 'N/A',
                target: objective.objectiveTarget || 'N/A',
                uom: objective.objectiveUOM || '',
                assignedWeight: assignedWeight,
                averageRating: parseFloat(averageRating.toFixed(2)),
                weightedScore: parseFloat(weightedScore.toFixed(2)),
                responseCount: ratings.length,
                qualitativeFeedback: answers?.map(a => a.objectiveQualInput).filter(Boolean).join('; ') || 'No comments'
            });
        }

        console.log('Processed objectives count:', processedObjectives.length);
        return processedObjectives;
        
    } catch (error) {
        console.error('Error in getObjectivesReportData:', error);
        return [];
    }
},
    getSkillsReportData: async function(feedbackId, feedbackIdField, jobId) {
    try {
        console.log('Getting skills data for feedbackId:', feedbackId, 'jobId:', jobId);
        
        // First get the skills questions for this feedback
        const { data: skillQuestions, error: questionsError } = await supabase
            .from('feedbacks_questions-skills')
            .select(`
                feedback_qSkillsId,
                jobReqSkillId,
                jobreqskills!inner(
                    jobReqSkillName,
                    jobReqSkillType
                )
            `)
            .eq(feedbackIdField, feedbackId);

        if (questionsError) {
            console.error('Error fetching skill questions:', questionsError);
            return { hardSkills: [], softSkills: [] };
        }

        if (!skillQuestions || skillQuestions.length === 0) {
            console.log('No skill questions found');
            return { hardSkills: [], softSkills: [] };
        }

        console.log('Found skill questions:', skillQuestions.length);

        const hardSkills = [];
        const softSkills = [];

        // Get answers for each skill question
        for (const question of skillQuestions) {
            const { data: answers, error: answersError } = await supabase
                .from('feedbacks_answers-skills')
                .select(`
                    skillsQuantInput,
                    skillsQualInput
                `)
                .eq('feedback_qSkillsId', question.feedback_qSkillsId);

            if (answersError) {
                console.error('Error fetching answers for skill:', question.jobReqSkillId, answersError);
                continue;
            }

            // Calculate average rating
            const ratings = answers?.map(a => a.skillsQuantInput).filter(r => r && r > 0) || [];
            const averageRating = ratings.length > 0 
                ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length 
                : 0;

            const skill = question.jobreqskills;
            const skillData = {
                skillName: skill.jobReqSkillName || 'Unknown Skill',
                skillType: skill.jobReqSkillType || 'Soft',
                averageRating: parseFloat(averageRating.toFixed(2)),
                responseCount: ratings.length,
                qualitativeFeedback: answers?.map(a => a.skillsQualInput).filter(Boolean).join('; ') || 'No comments'
            };

            if (skill.jobReqSkillType === 'Hard') {
                hardSkills.push(skillData);
            } else {
                softSkills.push(skillData);
            }
        }

        console.log('Processed skills:', { hardSkills: hardSkills.length, softSkills: softSkills.length });
        return { hardSkills, softSkills };
        
    } catch (error) {
        console.error('Error in getSkillsReportData:', error);
        return { hardSkills: [], softSkills: [] };
    }
},
calculateFeedbackSummary: function(objectivesData, skillsData) {
    try {
        console.log('Calculating feedback summary...');
        
        const objectivesCount = objectivesData.length;
        const averageObjectiveRating = objectivesCount > 0 
            ? objectivesData.reduce((sum, obj) => sum + obj.averageRating, 0) / objectivesCount 
            : 0;

        // Calculate total weighted score
        const totalWeightedScore = objectivesData.reduce((sum, obj) => sum + obj.weightedScore, 0);
        const totalWeight = objectivesData.reduce((sum, obj) => sum + obj.assignedWeight, 0);
        
        const hardSkillsCount = skillsData.hardSkills.length;
        const averageHardSkillRating = hardSkillsCount > 0 
            ? skillsData.hardSkills.reduce((sum, skill) => sum + skill.averageRating, 0) / hardSkillsCount 
            : 0;
        
        const softSkillsCount = skillsData.softSkills.length;
        const averageSoftSkillRating = softSkillsCount > 0 
            ? skillsData.softSkills.reduce((sum, skill) => sum + skill.averageRating, 0) / softSkillsCount 
            : 0;
        
        // Calculate overall performance score (weighted average)
        let overallPerformanceScore = 0;
        let totalComponents = 0;
        
        if (objectivesCount > 0) {
            overallPerformanceScore += averageObjectiveRating * 0.5; // 50% weight for objectives
            totalComponents += 0.5;
        }
        
        if (hardSkillsCount > 0) {
            overallPerformanceScore += averageHardSkillRating * 0.3; // 30% weight for hard skills
            totalComponents += 0.3;
        }
        
        if (softSkillsCount > 0) {
            overallPerformanceScore += averageSoftSkillRating * 0.2; // 20% weight for soft skills
            totalComponents += 0.2;
        }
        
        // Normalize the score if we have any components
        if (totalComponents > 0) {
            overallPerformanceScore = overallPerformanceScore / totalComponents;
        }
        
        const summary = {
            objectivesCount,
            averageObjectiveRating: parseFloat(averageObjectiveRating.toFixed(2)),
            hardSkillsCount,
            averageHardSkillRating: parseFloat(averageHardSkillRating.toFixed(2)),
            softSkillsCount,
            averageSoftSkillRating: parseFloat(averageSoftSkillRating.toFixed(2)),
            totalWeightedScore: parseFloat(totalWeightedScore.toFixed(2)),
            totalWeight: parseFloat(totalWeight.toFixed(2)),
            overallPerformanceScore: parseFloat(overallPerformanceScore.toFixed(2))
        };
        
        console.log('Calculated summary:', summary);
        return summary;
        
    } catch (error) {
        console.error('Error calculating feedback summary:', error);
        return {
            objectivesCount: 0,
            averageObjectiveRating: 0,
            hardSkillsCount: 0,
            averageHardSkillRating: 0,
            softSkillsCount: 0,
            averageSoftSkillRating: 0,
            totalWeightedScore: 0,
            totalWeight: 0,
            overallPerformanceScore: 0
        };
    }
},

// Mid-Year Feedback Report (Q1 + Q2)
getMidYearFeedbackReport: async function(req, res) {
    try {
        const { employeeId, year = new Date().getFullYear() } = req.query;
        
        console.log(`🔄 Generating Mid-Year report for employee ${employeeId}, year ${year}`);
        
        if (!employeeId) {
            return res.status(400).json({
                success: false,
                message: "Employee ID is required."
            });
        }
        
        // Get employee basic info
        const employeeInfo = await lineManagerController.getEmployeeBasicInfo(employeeId);
        if (!employeeInfo.success) {
            return res.status(404).json({
                success: false,
                message: "Employee not found."
            });
        }
        
        // Get Q1 and Q2 feedback data
        const q1Data = await lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q1', year);
        const q2Data = await lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q2', year);
        
        console.log(`Q1 Data Success: ${q1Data.success}, Q2 Data Success: ${q2Data.success}`);
        
        if (!q1Data.success && !q2Data.success) {
            return res.status(404).json({
                success: false,
                message: `No Q1 or Q2 feedback data found for ${year}.`
            });
        }
        
        // Combine Q1 and Q2 data
        const combinedData = combineMidYearData(q1Data, q2Data, employeeInfo.data, year);
        
        return res.json({
            success: true,
            data: combinedData
        });
        
    } catch (error) {
        console.error('❌ Error in getMidYearFeedbackReport:', error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while generating the mid-year report.",
            error: error.message
        });
    }
},


// Final-Year Feedback Report (Q3 + Q4)
getFinalYearFeedbackReport: async function(req, res) {
    try {
        const { employeeId, year = new Date().getFullYear() } = req.query;
        
        console.log(`🔄 Generating Final-Year report for employee ${employeeId}, year ${year}`);
        
        if (!employeeId) {
            return res.status(400).json({
                success: false,
                message: "Employee ID is required."
            });
        }
        
        // Get employee basic info
        const employeeInfo = await lineManagerController.getEmployeeBasicInfo(employeeId);
        if (!employeeInfo.success) {
            return res.status(404).json({
                success: false,
                message: "Employee not found."
            });
        }
        
        // Get Q3 and Q4 feedback data
        const q3Data = await lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q3', year);
        const q4Data = await lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q4', year);
        
        console.log(`Q3 Data Success: ${q3Data.success}, Q4 Data Success: ${q4Data.success}`);
        
        if (!q3Data.success && !q4Data.success) {
            return res.status(404).json({
                success: false,
                message: `No Q3 or Q4 feedback data found for ${year}.`
            });
        }
        
        // Combine Q3 and Q4 data
        const combinedData = combineFinalYearData(q3Data, q4Data, employeeInfo.data, year);
        
        return res.json({
            success: true,
            data: combinedData
        });
        
    } catch (error) {
        console.error('❌ Error in getFinalYearFeedbackReport:', error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while generating the final-year report.",
            error: error.message
        });
    }
},

// Comparison Feedback Report (Mid-Year vs Final-Year) - OPTIMIZED
getComparisonFeedbackReport: async function(req, res) {
    try {
        const { employeeId, year = new Date().getFullYear() } = req.query;
        
        console.log(`🔄 Generating Comparison report for employee ${employeeId}, year ${year}`);
        
        if (!employeeId) {
            return res.status(400).json({
                success: false,
                message: "Employee ID is required."
            });
        }
        
        // Get employee basic info
        const employeeInfo = await lineManagerController.getEmployeeBasicInfo(employeeId);
        if (!employeeInfo.success) {
            return res.status(404).json({
                success: false,
                message: "Employee not found."
            });
        }
        
        // OPTIMIZATION 1: Use Promise.all to fetch quarterly data in parallel instead of sequentially
        console.log('🚀 Fetching all quarterly data in parallel...');
        
        const [q1Data, q2Data, q3Data, q4Data] = await Promise.all([
            lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q1', year),
            lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q2', year),
            lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q3', year),
            lineManagerController.getQuarterlyFeedbackData(employeeId, 'Q4', year)
        ]);
        
        console.log(`✅ Parallel fetch completed - Q1: ${q1Data.success}, Q2: ${q2Data.success}, Q3: ${q3Data.success}, Q4: ${q4Data.success}`);
        
        // OPTIMIZATION 2: Early return if no data at all
        const hasAnyData = q1Data.success || q2Data.success || q3Data.success || q4Data.success;
        if (!hasAnyData) {
            return res.status(404).json({
                success: false,
                message: `No feedback data found for comparison in ${year}.`
            });
        }
        
        // OPTIMIZATION 3: Process mid-year and final-year in parallel
        console.log('📊 Processing comparison data...');
        
        const [midYearData, finalYearData] = await Promise.all([
            // Process mid-year data (Q1 + Q2)
            new Promise((resolve) => {
                try {
                    const result = combineMidYearData(q1Data, q2Data, employeeInfo.data, year);
                    resolve(result);
                } catch (error) {
                    console.error('Error combining mid-year data:', error);
                    resolve(null);
                }
            }),
            
            // Process final-year data (Q3 + Q4)
            new Promise((resolve) => {
                try {
                    const result = combineFinalYearData(q3Data, q4Data, employeeInfo.data, year);
                    resolve(result);
                } catch (error) {
                    console.error('Error combining final-year data:', error);
                    resolve(null);
                }
            })
        ]);
        
        // Check if we have at least some processed data
        const hasMidYear = midYearData && (q1Data.success || q2Data.success);
        const hasFinalYear = finalYearData && (q3Data.success || q4Data.success);
        
        if (!hasMidYear && !hasFinalYear) {
            return res.status(404).json({
                success: false,
                message: `No processable feedback data found for comparison in ${year}.`
            });
        }
        
        // Generate comparison data
        console.log('🔄 Generating final comparison...');
        const comparisonData = generateComparisonData(midYearData, finalYearData, employeeInfo.data, year);
        
        console.log('✅ Comparison report completed successfully');
        
        return res.json({
            success: true,
            data: comparisonData
        });
        
    } catch (error) {
        console.error('❌ Error in getComparisonFeedbackReport:', error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while generating the comparison report.",
            error: error.message
        });
    }
},

    getRespondentCounts: async function(userId, year) {
        const counts = {
            Q1: 0,
            Q2: 0,
            Q3: 0,
            Q4: 0,
            total: 0
        };
        
        try {
            console.log('Getting respondent counts for userId:', userId, 'year:', year);
            const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
            const uniqueRespondents = new Set();
            
            for (const quarter of quarters) {
                try {
                    const feedbackTable = `feedbacks_${quarter}`;
                    const feedbackIdField = `feedback${quarter.toLowerCase()}_Id`;
                    
                    console.log(`Checking ${quarter} respondents...`);
                    
                    // Get feedback record for this quarter
                    const { data: feedbackRecord, error: feedbackError } = await supabase
                        .from(feedbackTable)
                        .select(feedbackIdField)
                        .eq('userId', userId)
                        .eq('year', year)
                        .single();
                    
                    if (feedbackError || !feedbackRecord) {
                        console.log(`No ${quarter} feedback found:`, feedbackError?.message);
                        continue;
                    }
                    
                    // Count unique respondents for this quarter
                    const { data: respondents, error: respondentsError } = await supabase
                        .from('feedbacks_answers')
                        .select('reviewerUserId')
                        .eq(feedbackIdField, feedbackRecord[feedbackIdField])
                        .not('reviewerUserId', 'is', null);
                    
                    if (respondentsError) {
                        console.error(`Error getting ${quarter} respondents:`, respondentsError);
                        continue;
                    }
                    
                    if (respondents && respondents.length > 0) {
                        const quarterUniqueRespondents = new Set(respondents.map(r => r.reviewerUserId));
                        counts[quarter] = quarterUniqueRespondents.size;
                        
                        // Add to total unique respondents across all quarters
                        quarterUniqueRespondents.forEach(id => uniqueRespondents.add(id));
                        
                        console.log(`${quarter} respondents: ${counts[quarter]}`);
                    } else {
                        console.log(`No respondents found for ${quarter}`);
                    }
                    
                } catch (quarterError) {
                    console.error(`Error processing ${quarter}:`, quarterError);
                    continue;
                }
            }
            
            counts.total = uniqueRespondents.size;
            console.log('Final respondent counts:', counts);
            
            return counts;
            
        } catch (error) {
            console.error('Error getting respondent counts:', error);
            return counts;
        }
    },

// Line Manager Training Functions
// 1. Training Needs vs Completion Report
getEmployeeTrainingNeedsReport: async function (req, res) {
    try {
        console.log('📊 Loading Employee Training Needs Report...');
        
        const currentUserId = req.session?.user?.userId;
        const { timePeriod = 'thisYear' } = req.query;
        
        if (!currentUserId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - User not logged in'
            });
        }

        // Get manager's department info
        const { data: managerInfo, error: managerError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                firstName,
                lastName,
                departments!departmentId (deptName)
            `)
            .eq('userId', currentUserId)
            .single();

        if (managerError) throw new Error('Failed to get manager info');

        const departmentId = managerInfo?.departmentId;
        const departmentName = managerInfo?.departments?.deptName;
        const managerName = `${managerInfo?.firstName} ${managerInfo?.lastName}`;

        // Get employees in department
        const { data: employees, error: employeesError } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName,
                useraccounts!userId (userEmail),
                jobpositions!jobId (jobTitle)
            `)
            .eq('departmentId', departmentId);

        if (employeesError) throw new Error('Failed to get employees');

        const dateRange = calculateDateRange(timePeriod);

        // Get IDP training needs for each employee
        const employeeReports = await Promise.all(employees.map(async (employee) => {
            // Get IDP data
            const { data: idpData } = await supabase
                .from('midyearidps')
                .select('trainingCategories, topDevAreas, trainingRemarks')
                .eq('userId', employee.userId)
                .gte('created_at', dateRange.startDate.toISOString())
                .lte('created_at', dateRange.endDate.toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            // Get completed trainings
            const { data: completedTrainings } = await supabase
                .from('training_records')
                .select(`
                    trainingName,
                    status,
                    dateRequested,
                    training_records_categories!inner (
                        training_categories!inner (category)
                    )
                `)
                .eq('userId', employee.userId)
                .eq('isApproved', true)
                .in('status', ['Completed', 'In Progress'])
                .gte('dateRequested', dateRange.startDate.toISOString())
                .lte('dateRequested', dateRange.endDate.toISOString());

            // Process training needs vs completion
            let trainingNeeds = [];
            let completedCategories = [];

            if (idpData?.trainingCategories) {
                try {
                    trainingNeeds = typeof idpData.trainingCategories === 'string' 
                        ? JSON.parse(idpData.trainingCategories) 
                        : idpData.trainingCategories;
                } catch (e) {
                    trainingNeeds = [];
                }
            }

            if (completedTrainings) {
                completedCategories = completedTrainings.map(t => 
                    t.training_records_categories?.[0]?.training_categories?.category
                ).filter(Boolean);
            }

            const needsMetCount = trainingNeeds.filter(need => 
                completedCategories.includes(need)
            ).length;

            return {
                userId: employee.userId,
                name: `${employee.firstName} ${employee.lastName}`,
                email: employee.useraccounts?.userEmail,
                position: employee.jobpositions?.jobTitle,
                trainingNeeds: trainingNeeds || [],
                completedTrainings: completedTrainings || [],
                completedCategories,
                needsIdentified: trainingNeeds.length,
                needsMet: needsMetCount,
                completionRate: trainingNeeds.length > 0 ? Math.round((needsMetCount / trainingNeeds.length) * 100) : 0,
                developmentAreas: idpData?.topDevAreas || 'Not specified',
                trainingRemarks: idpData?.trainingRemarks || 'No remarks'
            };
        }));

        const reportData = {
            departmentName,
            managerName,
            reportDate: new Date().toLocaleDateString(),
            timePeriod,
            employees: employeeReports,
            summary: {
                totalEmployees: employees.length,
                employeesWithNeeds: employeeReports.filter(e => e.needsIdentified > 0).length,
                averageCompletionRate: Math.round(
                    employeeReports.reduce((sum, e) => sum + e.completionRate, 0) / employees.length
                ),
                totalNeedsIdentified: employeeReports.reduce((sum, e) => sum + e.needsIdentified, 0),
                totalNeedsMet: employeeReports.reduce((sum, e) => sum + e.needsMet, 0)
            }
        };

        res.json({ success: true, data: reportData });

    } catch (error) {
        console.error('❌ Error in getEmployeeTrainingNeedsReport:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load training needs report',
            error: error.message
        });
    }
},

// 2. Performance Improvement Report 
getPerformanceImprovementReport: async function (req, res) {
    try {
        console.log('📈 Loading Performance Improvement Report...');
        
        const currentUserId = req.session?.user?.userId;
        const { timePeriod = 'thisYear' } = req.query;
        
        if (!currentUserId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - User not logged in'
            });
        }

        // Get manager info and employees
        const { data: managerInfo } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                firstName,
                lastName,
                departments!departmentId (deptName)
            `)
            .eq('userId', currentUserId)
            .single();

        const departmentId = managerInfo?.departmentId;
        const departmentName = managerInfo?.departments?.deptName;
        const managerName = `${managerInfo?.firstName} ${managerInfo?.lastName}`;

        const { data: employees } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName,
                useraccounts!userId (userEmail),
                jobpositions!jobId (jobTitle)
            `)
            .eq('departmentId', departmentId);

        const dateRange = calculateDateRange(timePeriod);

        // Get performance data for each employee
        const performanceReports = await Promise.all(employees.map(async (employee) => {
            // Get completed trainings
            const { data: trainings } = await supabase
                .from('training_records')
                .select(`
                    trainingRecordId,
                    trainingName,
                    setStartDate,
                    setEndDate,
                    dateRequested,
                    status
                `)
                .eq('userId', employee.userId)
                .eq('status', 'Completed')
                .gte('dateRequested', dateRange.startDate.toISOString())
                .lte('dateRequested', dateRange.endDate.toISOString());

            // For each training, get before/after performance scores
            const trainingPerformance = await Promise.all((trainings || []).map(async (training) => {
                const performanceData = await getEmployeePerformanceScoresSimple(
                    employee.userId, 
                    training.setStartDate, 
                    training.setEndDate
                );

                return {
                    trainingName: training.trainingName,
                    dateCompleted: training.setEndDate,
                    beforeScore: performanceData.beforeScore,
                    afterScore: performanceData.afterScore,
                    improvement: performanceData.beforeScore && performanceData.afterScore 
                        ? ((performanceData.afterScore - performanceData.beforeScore) / performanceData.beforeScore * 100)
                        : null
                };
            }));

            const validImprovements = trainingPerformance
                .filter(tp => tp.improvement !== null)
                .map(tp => tp.improvement);

            return {
                userId: employee.userId,
                name: `${employee.firstName} ${employee.lastName}`,
                email: employee.useraccounts?.userEmail,
                position: employee.jobpositions?.jobTitle,
                trainingsCompleted: trainings?.length || 0,
                trainingPerformance,
                averageImprovement: validImprovements.length > 0 
                    ? validImprovements.reduce((sum, imp) => sum + imp, 0) / validImprovements.length 
                    : 0,
                hasPerformanceData: validImprovements.length > 0
            };
        }));

        const reportData = {
            departmentName,
            managerName,
            reportDate: new Date().toLocaleDateString(),
            timePeriod,
            employees: performanceReports,
            summary: {
                totalEmployees: employees.length,
                employeesWithTraining: performanceReports.filter(e => e.trainingsCompleted > 0).length,
                employeesWithPerformanceData: performanceReports.filter(e => e.hasPerformanceData).length,
                averageImprovement: Math.round(
                    performanceReports
                        .filter(e => e.hasPerformanceData)
                        .reduce((sum, e) => sum + e.averageImprovement, 0) / 
                    Math.max(performanceReports.filter(e => e.hasPerformanceData).length, 1)
                ),
                totalTrainingsCompleted: performanceReports.reduce((sum, e) => sum + e.trainingsCompleted, 0)
            }
        };

        res.json({ success: true, data: reportData });

    } catch (error) {
        console.error('❌ Error in getPerformanceImprovementReport:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load performance improvement report',
            error: error.message
        });
    }
},

// 3. Training Summary Report
getTrainingSummaryReport: async function (req, res) {
    try {
        console.log('📋 Loading Training Summary Report...');
        
        const currentUserId = req.session?.user?.userId;
        const { timePeriod = 'thisYear' } = req.query;
        
        if (!currentUserId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - User not logged in'
            });
        }

        // Get manager info
        const { data: managerInfo } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                firstName,
                lastName,
                departments!departmentId (deptName)
            `)
            .eq('userId', currentUserId)
            .single();

        const departmentId = managerInfo?.departmentId;
        const departmentName = managerInfo?.departments?.deptName;
        const managerName = `${managerInfo?.firstName} ${managerInfo?.lastName}`;

        const { data: employees } = await supabase
            .from('staffaccounts')
            .select(`
                userId, 
                firstName, 
                lastName,
                useraccounts!userId (userEmail),
                jobpositions!jobId (jobTitle)
            `)
            .eq('departmentId', departmentId);

        const dateRange = calculateDateRange(timePeriod);

        // Get training summary for each employee
        const trainingSummaries = await Promise.all(employees.map(async (employee) => {
            const { data: trainings } = await supabase
                .from('training_records')
                .select(`
                    trainingName,
                    status,
                    cost,
                    totalDuration,
                    dateRequested,
                    training_records_categories!inner (
                        training_categories!inner (category)
                    )
                `)
                .eq('userId', employee.userId)
                .eq('isApproved', true)
                .gte('dateRequested', dateRange.startDate.toISOString())
                .lte('dateRequested', dateRange.endDate.toISOString());

            // Group by category
            const categoryStats = {};
            let totalCost = 0;
            let totalHours = 0;

            (trainings || []).forEach(training => {
                const category = training.training_records_categories?.[0]?.training_categories?.category || 'Uncategorized';
                
                if (!categoryStats[category]) {
                    categoryStats[category] = { count: 0, cost: 0, hours: 0, completed: 0 };
                }
                
                categoryStats[category].count++;
                categoryStats[category].cost += parseFloat(training.cost || 0);
                categoryStats[category].hours += parseFloat(training.totalDuration || 0);
                
                if (training.status === 'Completed') {
                    categoryStats[category].completed++;
                }

                totalCost += parseFloat(training.cost || 0);
                totalHours += parseFloat(training.totalDuration || 0);
            });

            return {
                userId: employee.userId,
                name: `${employee.firstName} ${employee.lastName}`,
                email: employee.useraccounts?.userEmail,
                position: employee.jobpositions?.jobTitle,
                totalTrainings: trainings?.length || 0,
                completedTrainings: trainings?.filter(t => t.status === 'Completed').length || 0,
                inProgressTrainings: trainings?.filter(t => t.status === 'In Progress').length || 0,
                totalCost,
                totalHours,
                categoryBreakdown: Object.entries(categoryStats).map(([category, stats]) => ({
                    category,
                    ...stats,
                    completionRate: stats.count > 0 ? Math.round((stats.completed / stats.count) * 100) : 0
                })),
                completionRate: trainings?.length > 0 
                    ? Math.round((trainings.filter(t => t.status === 'Completed').length / trainings.length) * 100) 
                    : 0
            };
        }));

        const reportData = {
            departmentName,
            managerName,
            reportDate: new Date().toLocaleDateString(),
            timePeriod,
            employees: trainingSummaries,
            summary: {
                totalEmployees: employees.length,
                totalTrainings: trainingSummaries.reduce((sum, e) => sum + e.totalTrainings, 0),
                totalCompleted: trainingSummaries.reduce((sum, e) => sum + e.completedTrainings, 0),
                totalInProgress: trainingSummaries.reduce((sum, e) => sum + e.inProgressTrainings, 0),
                totalCost: trainingSummaries.reduce((sum, e) => sum + e.totalCost, 0),
                totalHours: trainingSummaries.reduce((sum, e) => sum + e.totalHours, 0),
                averageCompletionRate: Math.round(
                    trainingSummaries.reduce((sum, e) => sum + e.completionRate, 0) / employees.length
                )
            }
        };

        res.json({ success: true, data: reportData });

    } catch (error) {
        console.error('❌ Error in getTrainingSummaryReport:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load training summary report',
            error: error.message
        });
    }
},

// Recruitment Line Mnaager Reports
getRecruitmentReports: async function (req, res) {
    if (req.session.user && req.session.user.userRole === 'Line Manager') {
        res.render('staffpages/linemanager_pages/reports_page/linemanager-recruitment-reports');
    } else {
        req.flash('errors', { authError: 'Unauthorized. Line Manager access only.' });
        res.redirect('/staff/login');
    }
},


// 1. Get line manager's department info
getDepartmentInfo: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        console.log('🔍 [Line Manager] Fetching department info...');
        
        // Get line manager's staff account to find department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select(`
                departmentId,
                departments!inner(departmentId, deptName)
            `)
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError) {
            console.error('❌ [Line Manager] Error fetching staff account:', staffError);
            throw staffError;
        }

        if (!staffAccount || !staffAccount.departments) {
            return res.status(404).json({ 
                success: false, 
                message: 'Department information not found for your account' 
            });
        }

        console.log(`✅ [Line Manager] Found department: ${staffAccount.departments.deptName}`);

        return res.json({
            success: true,
            department: {
                departmentId: staffAccount.departmentId,
                deptName: staffAccount.departments.deptName
            }
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error fetching department info:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error fetching department information: ' + error.message 
        });
    }
},

// 2. Get department-specific dashboard statistics
getDeptDashboardStats: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        console.log('🔍 [Line Manager] Fetching department dashboard stats...');

        // First get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;
        console.log(`📍 [Line Manager] Department ID: ${departmentId}`);

        // Get department applicants
        const { data: deptApplicants, error: applicantsError } = await supabase
            .from('applicantaccounts')
            .select('applicantId, applicantStatus, created_at')
            .eq('departmentId', departmentId);

        if (applicantsError) {
            console.error('❌ [Line Manager] Error fetching department applicants:', applicantsError);
            throw applicantsError;
        }

        console.log(`✅ [Line Manager] Found ${deptApplicants.length} department applicants`);

        // Get department hirees
        const deptHirees = deptApplicants.filter(a => 
            a.applicantStatus?.includes('Hired') || a.applicantStatus?.includes('Onboarding')
        );

        // Get pending reviews (applications awaiting line manager review)
        const pendingReviews = deptApplicants.filter(a => {
            const status = a.applicantStatus || '';
            return status.includes('Awaiting Line Manager') || 
                   status.includes('Panel Interview') ||
                   status.includes('P2');
        });

        // Get line manager's MRFs
        const { data: yourMRFs, error: mrfError } = await supabase
            .from('mrf')
            .select('mrfId')
            .eq('userId', req.session.user.userId)
            .in('status', ['Pending', 'Approved']);

        if (mrfError) {
            console.error('❌ [Line Manager] Error fetching MRFs:', mrfError);
        }

        // Calculate average hiring time for department
        let avgHiringTime = 0;
        if (deptHirees.length > 0) {
            const hiringTimes = deptHirees.map(h => {
                const applicationDate = new Date(h.created_at);
                const currentDate = new Date();
                return Math.floor((currentDate - applicationDate) / (1000 * 60 * 60 * 24));
            });
            avgHiringTime = Math.round(hiringTimes.reduce((sum, time) => sum + time, 0) / hiringTimes.length);
        }

        // Get this month's department applications
        const currentDate = new Date();
        const monthlyDeptApplicants = deptApplicants.filter(a => {
            const appDate = new Date(a.created_at);
            return appDate.getMonth() === currentDate.getMonth() && 
                   appDate.getFullYear() === currentDate.getFullYear();
        });

        const stats = {
            deptApplicants: deptApplicants.length,
            deptHirees: deptHirees.length,
            pendingReviews: pendingReviews.length,
            yourMRFs: yourMRFs ? yourMRFs.length : 0,
            avgHiringTime: avgHiringTime,
            monthlyDeptApplicants: monthlyDeptApplicants.length
        };

        console.log('📊 [Line Manager] Department stats:', stats);

        return res.json({
            success: true,
            stats: stats
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error fetching department dashboard stats:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error fetching department statistics: ' + error.message 
        });
    }
},

// 3. Get department-specific chart data
getDeptChartData: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        console.log('🔍 [Line Manager] Fetching department chart data...');

        // Get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;

        // Get department applicants with job data
        const { data: deptApplicants, error: applicantsError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                applicantStatus,
                created_at,
                jobpositions!inner(jobTitle)
            `)
            .eq('departmentId', departmentId);

        if (applicantsError) {
            console.error('❌ [Line Manager] Error fetching department applicants:', applicantsError);
            throw applicantsError;
        }

        console.log(`✅ [Line Manager] Found ${deptApplicants.length} department applicants for charts`);

        // 1. Department Status Distribution
        const statusCounts = {
            pending: 0,
            hrInterview: 0,
            yourReview: 0,
            hired: 0,
            rejected: 0
        };

        deptApplicants.forEach(applicant => {
            const status = applicant.applicantStatus || '';
            const statusLower = status.toLowerCase();
            
            if (statusLower.includes('hired') || statusLower.includes('onboarding')) {
                statusCounts.hired++;
            } else if (statusLower.includes('line manager') || statusLower.includes('p2') || statusLower.includes('panel')) {
                statusCounts.yourReview++;
            } else if (statusLower.includes('hr interview') || statusLower.includes('p1')) {
                statusCounts.hrInterview++;
            } else if (statusLower.includes('failed') || statusLower.includes('rejected')) {
                statusCounts.rejected++;
            } else {
                statusCounts.pending++;
            }
        });

        // 2. Monthly Department Trends (last 6 months)
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

        // Count department applications and hires by month
        deptApplicants.forEach(applicant => {
            const appDate = new Date(applicant.created_at);
            const monthKey = `${appDate.getFullYear()}-${String(appDate.getMonth() + 1).padStart(2, '0')}`;
            
            if (monthlyData[monthKey]) {
                monthlyData[monthKey].applications++;
                
                const status = applicant.applicantStatus || '';
                if (status.toLowerCase().includes('hired') || status.toLowerCase().includes('onboarding')) {
                    monthlyData[monthKey].hires++;
                }
            }
        });

        const monthlyTrends = Object.values(monthlyData);

        /// 3. Line Manager's MRF Progress
        const { data: yourMRFs, error: mrfError } = await supabase
            .from('mrf')
            .select('status')
            .eq('userId', req.session.user.userId);

        const mrfCounts = {
            pending: 0,
            approved: 0,
            notApproved: 0
        };

        if (yourMRFs) {
            yourMRFs.forEach(mrf => {
                const status = (mrf.status || '').toLowerCase();
                
                // Match your actual status values
                if (status === 'pending' || status.includes('pending')) {
                    mrfCounts.pending++;
                } else if (status === 'approved' || status.includes('approved')) {
                    mrfCounts.approved++;
                } else if (status === 'not approved' || status.includes('not approved') || status.includes('rejected') || status.includes('declined')) {
                    mrfCounts.notApproved++;
                } else {
                    // Default unknown statuses to pending
                    mrfCounts.pending++;
                }
            });
        }

        console.log('📊 [Line Manager] MRF Counts:', mrfCounts); // Debug log to see actual data

        // 4. Department Timeline Distribution
        const timelineCounts = {
            '0-15 days': 0,
            '16-30 days': 0,
            '31-45 days': 0,
            '46+ days': 0
        };

        // Calculate timeline for hired department applicants
        const hiredDeptApplicants = deptApplicants.filter(a => {
            const status = a.applicantStatus || '';
            return status.toLowerCase().includes('hired') || status.toLowerCase().includes('onboarding');
        });

        hiredDeptApplicants.forEach(applicant => {
            const appDate = new Date(applicant.created_at);
            const currentDate = new Date();
            const daysDiff = Math.floor((currentDate - appDate) / (1000 * 60 * 60 * 24));

            if (daysDiff <= 15) {
                timelineCounts['0-15 days']++;
            } else if (daysDiff <= 30) {
                timelineCounts['16-30 days']++;
            } else if (daysDiff <= 45) {
                timelineCounts['31-45 days']++;
            } else {
                timelineCounts['46+ days']++;
            }
        });

        const chartData = {
            statusDistribution: {
                labels: ['Pending', 'HR Interview', 'Your Review', 'Hired', 'Rejected'],
                data: [
                    statusCounts.pending,
                    statusCounts.hrInterview,
                    statusCounts.yourReview,
                    statusCounts.hired,
                    statusCounts.rejected
                ]
            },
            monthlyTrends: {
                labels: monthlyTrends.map(m => m.month),
                applications: monthlyTrends.map(m => m.applications),
                hires: monthlyTrends.map(m => m.hires)
            },
            mrfProgress: {
                // Updated to match your actual statuses
                labels: ['Pending', 'Approved', 'Not Approved'],
                data: [
                    mrfCounts.pending,
                    mrfCounts.approved,
                    mrfCounts.notApproved
                ]
            },
            timeline: {
                labels: Object.keys(timelineCounts),
                data: Object.values(timelineCounts)
            }
        };

        console.log('📊 [Line Manager] Department chart data prepared');

        return res.json({
            success: true,
            chartData: chartData
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error fetching department chart data:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error fetching department chart data: ' + error.message 
        });
    }
},

// 4. Get department applicants report
getDeptApplicantsReport: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { startDate, endDate, format } = req.query;
        
        console.log('🔍 [Line Manager] Fetching department applicants report...');
        
        // Get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;

        // Enhanced query for department applicants
        let query = supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                lastName,
                firstName,
                middleInitial,
                phoneNo,
                applicantStatus,
                initialScreeningScore,
                hrInterviewFormScore,
                lineManagerFormEvalScore,
                created_at,
                userId,
                jobId,
                useraccounts!inner(userEmail),
                jobpositions!inner(jobTitle),
                departments!inner(deptName)
            `)
            .eq('departmentId', departmentId)
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
            console.error('❌ [Line Manager] Error fetching department applicants:', error);
            return res.status(500).json({ success: false, message: 'Error fetching department applicants: ' + error.message });
        }

        console.log(`✅ [Line Manager] Found ${applicants.length} department applicants`);

        // === BUSINESS INTELLIGENCE ANALYSIS ===

        // 1. Performance Analysis
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

        // 2. Pipeline Efficiency Analysis
        const pipelineAnalysis = {
            pendingYourAction: applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                return status.includes('awaiting line manager') || 
                       status.includes('pending your review') ||
                       status.includes('p2') ||
                       status.includes('panel interview');
            }),
            stuckInHR: applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                const daysSinceApplication = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                return status.includes('hr') && daysSinceApplication > 14;
            }),
            fastTrack: applicants.filter(a => {
                const daysSinceApplication = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                const status = (a.applicantStatus || '').toLowerCase();
                return daysSinceApplication <= 7 && (status.includes('hired') || status.includes('final'));
            })
        };

        // 3. Quality Analysis
        const qualityMetrics = {
            avgInitialScore: applicants.length > 0 ? 
                Math.round(applicants.reduce((sum, a) => sum + (a.initialScreeningScore || 0), 0) / applicants.length) : 0,
            avgHRScore: applicants.length > 0 ?
                Math.round(applicants.reduce((sum, a) => sum + (a.hrInterviewFormScore || 0), 0) / applicants.length) : 0,
            avgYourScore: applicants.length > 0 ?
                Math.round(applicants.reduce((sum, a) => sum + (a.lineManagerFormEvalScore || 0), 0) / applicants.length) : 0,
            conversionRate: applicants.length > 0 ?
                Math.round((applicants.filter(a => (a.applicantStatus || '').toLowerCase().includes('hired')).length / applicants.length) * 100) : 0
        };

        // 4. Timeline Analysis
        const timelineAnalysis = {
            avgProcessingTime: applicants.length > 0 ?
                Math.round(applicants.reduce((sum, a) => {
                    return sum + Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                }, 0) / applicants.length) : 0,
            quickHires: applicants.filter(a => {
                const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                return days <= 14 && (a.applicantStatus || '').toLowerCase().includes('hired');
            }).length,
            delayedCandidates: applicants.filter(a => {
                const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                const status = (a.applicantStatus || '').toLowerCase();
                return days > 30 && !status.includes('hired') && !status.includes('rejected');
            }).length
        };

        // === INTELLIGENT INSIGHTS GENERATION ===
        const insights = [];
        const actionItems = [];
        const recommendations = [];

        // Performance Insights
        if (performanceAnalysis.highPerformers.length > 0) {
            insights.push(`🌟 ${performanceAnalysis.highPerformers.length} high-performing candidates identified - consider fast-tracking these applications`);
            actionItems.push(`Review ${performanceAnalysis.highPerformers.length} high-performers for immediate interview scheduling`);
        }

        if (performanceAnalysis.lowPerformers.length > performanceAnalysis.highPerformers.length && performanceAnalysis.lowPerformers.length > 3) {
            insights.push(`⚠️ High ratio of low-performing candidates suggests need to review job requirements or screening criteria`);
            recommendations.push('Consider tightening initial screening requirements to improve candidate quality');
        }

        // Pipeline Insights
        if (pipelineAnalysis.pendingYourAction.length > 0) {
            insights.push(`⏰ ${pipelineAnalysis.pendingYourAction.length} applicants awaiting your review - prompt action needed to maintain pipeline flow`);
            actionItems.push(`Schedule interviews for ${pipelineAnalysis.pendingYourAction.length} pending candidates within 3 business days`);
        }

        if (pipelineAnalysis.stuckInHR.length > 0) {
            insights.push(`🚫 ${pipelineAnalysis.stuckInHR.length} candidates stuck in HR stage for >14 days - follow up recommended`);
            actionItems.push(`Coordinate with HR to resolve ${pipelineAnalysis.stuckInHR.length} delayed applications`);
        }

        if (pipelineAnalysis.fastTrack.length > 0) {
            insights.push(`🚀 ${pipelineAnalysis.fastTrack.length} candidates processed efficiently (≤7 days) - excellent pipeline velocity`);
        }

        // Quality Insights
        if (qualityMetrics.conversionRate < 15 && applicants.length > 10) {
            insights.push(`📉 Low conversion rate (${qualityMetrics.conversionRate}%) indicates potential issues with candidate quality or process efficiency`);
            recommendations.push('Analyze rejection reasons and consider adjusting recruitment channels or requirements');
        }

        if (qualityMetrics.conversionRate > 40 && applicants.length > 5) {
            insights.push(`📈 Excellent conversion rate (${qualityMetrics.conversionRate}%) - your department attracts quality candidates`);
        }

        if (qualityMetrics.avgYourScore > 0 && qualityMetrics.avgYourScore < 60) {
            insights.push(`📊 Your average interview score (${qualityMetrics.avgYourScore}) suggests candidates may not fully meet role requirements`);
            recommendations.push('Consider refining job descriptions or working with HR to improve pre-screening');
        }

        // Timeline Insights
        if (timelineAnalysis.avgProcessingTime > 45) {
            insights.push(`⏱️ Average processing time (${timelineAnalysis.avgProcessingTime} days) exceeds best practices - streamlining recommended`);
            recommendations.push('Target reducing average processing time to under 30 days through process optimization');
        }

        if (timelineAnalysis.delayedCandidates > 0) {
            insights.push(`🔄 ${timelineAnalysis.delayedCandidates} candidates in process >30 days - risk of candidate drop-off`);
            actionItems.push(`Prioritize decisions on ${timelineAnalysis.delayedCandidates} long-pending applications`);
        }

        // Department Comparison (if available)
        if (applicants.length > 0) {
            // Get company average for comparison
            const { data: companyApplicants } = await supabase
                .from('applicantaccounts')
                .select('applicantStatus, created_at, lineManagerFormEvalScore')
                .gte('created_at', startDate || '2024-01-01')
                .lte('created_at', endDate || new Date().toISOString());

            if (companyApplicants && companyApplicants.length > 0) {
                const companyConversionRate = Math.round(
                    (companyApplicants.filter(a => (a.applicantStatus || '').toLowerCase().includes('hired')).length / companyApplicants.length) * 100
                );
                
                if (qualityMetrics.conversionRate > companyConversionRate + 10) {
                    insights.push(`🏆 Your department's conversion rate (${qualityMetrics.conversionRate}%) exceeds company average (${companyConversionRate}%)`);
                } else if (qualityMetrics.conversionRate < companyConversionRate - 10) {
                    insights.push(`📊 Your department's conversion rate (${qualityMetrics.conversionRate}%) is below company average (${companyConversionRate}%)`);
                    recommendations.push('Analyze successful departments\' practices and consider adopting similar strategies');
                }
            }
        }

        // Enhanced summary statistics
        const summary = {
            totalDeptApplications: applicants.length,
            awaitingYourReview: pipelineAnalysis.pendingYourAction.length,
            hrScreeningPassed: applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                return status.includes('passed hr') || status.includes('p1 passed') || (a.hrInterviewFormScore && a.hrInterviewFormScore > 0);
            }).length,
            deptHired: applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                return status.includes('hired') || status.includes('onboarding');
            }).length,
            rejectedByYou: applicants.filter(a => {
                const status = (a.applicantStatus || '').toLowerCase();
                return status.includes('line manager rejected') || status.includes('p2 failed');
            }).length,
            // Intelligence metrics
            avgProcessingTime: timelineAnalysis.avgProcessingTime,
            conversionRate: qualityMetrics.conversionRate,
            avgYourScore: qualityMetrics.avgYourScore,
            highPerformers: performanceAnalysis.highPerformers.length,
            urgentActions: actionItems.length
        };

        // Helper function to calculate total score
        const calculateTotalScore = (applicant) => {
            const initial = applicant.initialScreeningScore || 0;
            const hr = applicant.hrInterviewFormScore || 0;
            const lineManager = applicant.lineManagerFormEvalScore || 0;
            
            if (initial > 0 || hr > 0 || lineManager > 0) {
                return initial + hr + lineManager;
            }
            return null;
        };

        // Process department applicants data with intelligence flags
        const processedApplicants = applicants.map(applicant => {
            const totalScore = calculateTotalScore(applicant);
            const daysSinceApplication = Math.floor((new Date() - new Date(applicant.created_at)) / (1000 * 60 * 60 * 24));
            
            // Intelligence flags
            let flags = [];
            if (totalScore && totalScore >= 240) flags.push('high-performer');
            if (daysSinceApplication > 30) flags.push('delayed');
            if ((applicant.applicantStatus || '').toLowerCase().includes('awaiting line manager')) flags.push('pending-your-action');
            if (totalScore && totalScore < 150) flags.push('low-score');

            return {
                applicantId: applicant.applicantId,
                lastName: applicant.lastName || 'N/A',
                firstName: applicant.firstName || 'N/A',
                middleInitial: applicant.middleInitial || '',
                email: applicant.useraccounts?.userEmail || 'N/A',
                phoneNumber: applicant.phoneNo || 'N/A',
                jobTitle: applicant.jobpositions?.jobTitle || 'N/A',
                applicationDate: applicant.created_at ? 
                    new Date(applicant.created_at).toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: '2-digit', 
                        day: '2-digit' 
                    }) : 'N/A',
                status: applicant.applicantStatus || 'Pending',
                initialScreeningScore: applicant.initialScreeningScore || 'N/A',
                hrInterviewScore: applicant.hrInterviewFormScore || 'N/A',
                lineManagerScore: applicant.lineManagerFormEvalScore || 'N/A',
                totalScore: totalScore || 'N/A',
                daysInProcess: daysSinceApplication,
                intelligenceFlags: flags
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
            insights: insights,
            actionItems: actionItems,
            recommendations: recommendations,
            intelligence: {
                performanceAnalysis,
                pipelineAnalysis,
                qualityMetrics,
                timelineAnalysis
            },
            generatedOn: generatedOn,
            reportTitle: 'Department Applicants Report - Intelligence Enhanced'
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error in getDeptApplicantsReport:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
},

// 5. Get department hirees report
// Enhanced getDeptHireesReport with Business Intelligence
getDeptHireesReport: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { startDate, endDate, format } = req.query;
        
        console.log('🔍 [Line Manager] Fetching department hirees report...');
        
        // Get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;

        // Enhanced query for department applicants with more data
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
                initialScreeningScore,
                hrInterviewFormScore,
                lineManagerFormEvalScore,
                userId,
                jobId,
                useraccounts!inner(userEmail),
                jobpositions!inner(jobTitle, jobType),
                departments!inner(deptName)
            `)
            .eq('departmentId', departmentId)
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
            console.error('❌ [Line Manager] Error fetching department applicants:', error);
            return res.status(500).json({ success: false, message: 'Error fetching department applicants: ' + error.message });
        }

        // Filter for hired department applicants
        const hirees = allApplicants.filter(applicant => {
            const status = applicant.applicantStatus || '';
            return status.toLowerCase().includes('hired') || 
                   status.toLowerCase().includes('onboarding');
        });

        console.log(`✅ [Line Manager] Found ${hirees.length} department hirees`);

        // === BUSINESS INTELLIGENCE ANALYSIS ===

        // 1. Hiring Quality Analysis
        const qualityAnalysis = {
            excellentHires: hirees.filter(h => {
                const total = (h.initialScreeningScore || 0) + (h.hrInterviewFormScore || 0) + (h.lineManagerFormEvalScore || 0);
                return total >= 270; // 90%+ of 300 max score
            }),
            goodHires: hirees.filter(h => {
                const total = (h.initialScreeningScore || 0) + (h.hrInterviewFormScore || 0) + (h.lineManagerFormEvalScore || 0);
                return total >= 210 && total < 270; // 70-89%
            }),
            averageHires: hirees.filter(h => {
                const total = (h.initialScreeningScore || 0) + (h.hrInterviewFormScore || 0) + (h.lineManagerFormEvalScore || 0);
                return total >= 150 && total < 210; // 50-69%
            }),
            riskHires: hirees.filter(h => {
                const total = (h.initialScreeningScore || 0) + (h.hrInterviewFormScore || 0) + (h.lineManagerFormEvalScore || 0);
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

        // 3. Job Type Distribution Analysis
        const jobTypeAnalysis = {
            fullTime: hirees.filter(h => h.jobpositions?.jobType === 'Full-time'),
            partTime: hirees.filter(h => h.jobpositions?.jobType === 'Part-time'),
            contract: hirees.filter(h => h.jobpositions?.jobType === 'Contract'),
            internship: hirees.filter(h => h.jobpositions?.jobType === 'Internship'),
            temporary: hirees.filter(h => h.jobpositions?.jobType === 'Temporary')
        };

        // 4. Onboarding Status Analysis
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

        // 5. Seasonal Trends Analysis
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

        // 6. Performance Score Analysis
        const scoreAnalysis = {
            avgInitialScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => sum + (h.initialScreeningScore || 0), 0) / hirees.length) : 0,
            avgHRScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => sum + (h.hrInterviewFormScore || 0), 0) / hirees.length) : 0,
            avgLineManagerScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => sum + (h.lineManagerFormEvalScore || 0), 0) / hirees.length) : 0,
            avgTotalScore: hirees.length > 0 ? Math.round(hirees.reduce((sum, h) => {
                return sum + ((h.initialScreeningScore || 0) + (h.hrInterviewFormScore || 0) + (h.lineManagerFormEvalScore || 0));
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

        if (velocityAnalysis.slowHires.length > 0 && velocityAnalysis.slowHires.length > velocityAnalysis.fastHires.length) {
            insights.push(`📉 ${velocityAnalysis.slowHires.length} slow hires (>45 days) indicate process bottlenecks`);
            recommendations.push('Analyze common delays in slow hires and implement process improvements');
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

        // Department Performance vs Goals
        if (hirees.length > 0) {
            // Get company hiring data for comparison
            const { data: companyHires } = await supabase
                .from('applicantaccounts')
                .select('applicantStatus, created_at, departmentId')
                .gte('created_at', startDate || '2024-01-01')
                .lte('created_at', endDate || new Date().toISOString());

            if (companyHires) {
                const allCompanyHires = companyHires.filter(h => 
                    (h.applicantStatus || '').toLowerCase().includes('hired')
                );
                
                const deptHireRate = hirees.length;
                const companyAvgPerDept = allCompanyHires.length / new Set(allCompanyHires.map(h => h.departmentId)).size;
                
                if (deptHireRate > companyAvgPerDept * 1.2) {
                    insights.push(`🏆 Your department's hiring rate exceeds company average by 20%+ - excellent performance`);
                    successMetrics.push('Above-average hiring performance contributes to organizational growth');
                } else if (deptHireRate < companyAvgPerDept * 0.8) {
                    insights.push(`📊 Your department's hiring rate is below company average - consider scaling recruitment efforts`);
                    recommendations.push('Evaluate current hiring needs and consider expanding recruitment activities');
                }
            }
        }

        // Retention Risk Assessment
        const highRiskHires = hirees.filter(h => {
            const totalScore = (h.initialScreeningScore || 0) + (h.hrInterviewFormScore || 0) + (h.lineManagerFormEvalScore || 0);
            const daysToHire = Math.floor((new Date() - new Date(h.created_at)) / (1000 * 60 * 60 * 24));
            return totalScore < 180 || daysToHire > 60; // Low score or very slow hire
        });

        if (highRiskHires.length > 0) {
            insights.push(`🚨 ${highRiskHires.length} hires flagged as retention risk - proactive management recommended`);
            actionItems.push(`Implement enhanced support and mentoring for ${highRiskHires.length} at-risk new hires`);
            recommendations.push('Develop retention-focused onboarding plan for lower-scoring hires');
        }

        // Enhanced summary statistics with intelligence
        const summary = {
            totalDeptHirees: hirees.length,
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
            const total = (hiree.initialScreeningScore || 0) + (hiree.hrInterviewFormScore || 0) + (hiree.lineManagerFormEvalScore || 0);
            if (total >= 270) return 'Excellent';
            if (total >= 210) return 'Good';
            if (total >= 150) return 'Average';
            if (total > 0) return 'Risk';
            return 'No Score';
        };

        // Process department hirees data with intelligence flags
        const processedHirees = hirees.map((hiree, index) => {
            const totalScore = (hiree.initialScreeningScore || 0) + (hiree.hrInterviewFormScore || 0) + (hiree.lineManagerFormEvalScore || 0);
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
                hireId: `DEPT-HIR${String(index + 1).padStart(3, '0')}`,
                lastName: hiree.lastName || 'N/A',
                firstName: hiree.firstName || 'N/A', 
                middleInitial: hiree.middleInitial || '',
                email: hiree.useraccounts?.userEmail || 'N/A',
                phoneNumber: hiree.phoneNo || 'N/A',
                jobTitle: hiree.jobpositions?.jobTitle || 'N/A',
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
                jobTypeAnalysis,
                onboardingAnalysis,
                seasonalAnalysis,
                scoreAnalysis
            },
            generatedOn: generatedOn,
            reportTitle: 'Department Hirees Report - Intelligence Enhanced'
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error in getDeptHireesReport:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
},

// 6. Search department applicants for dropdown
getSearchDeptApplicants: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { query, loadAll } = req.query;
        
        console.log('🔍 [Line Manager] Search department applicants. Query:', query, 'LoadAll:', loadAll);
        
        // Get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;
        const shouldLoadAll = loadAll === 'true' || query === 'all';
        
        if (!shouldLoadAll && (!query || query.trim().length < 2)) {
            return res.json({ success: true, applicants: [] });
        }

        // Search for department applicants only
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
                useraccounts!inner(userEmail),
                jobpositions!inner(jobTitle)
            `)
            .eq('departmentId', departmentId)
            .order('created_at', { ascending: false })
            .limit(shouldLoadAll ? 100 : 30);

        if (error) {
            console.error('❌ [Line Manager] Error searching department applicants:', error);
            return res.status(500).json({ success: false, message: 'Error searching department applicants' });
        }

        let filteredApplicants = applicants;

        // Filter by search term if not loading all
        if (!shouldLoadAll) {
            const searchTerm = query.trim().toLowerCase();
            
            filteredApplicants = applicants.filter(applicant => {
                const firstName = (applicant.firstName || '').toLowerCase();
                const lastName = (applicant.lastName || '').toLowerCase();
                const fullName = `${firstName} ${lastName}`;
                const reverseName = `${lastName} ${firstName}`;
                const email = (applicant.useraccounts?.userEmail || '').toLowerCase();
                const position = (applicant.jobpositions?.jobTitle || '').toLowerCase();
                
                return firstName.includes(searchTerm) || 
                       lastName.includes(searchTerm) || 
                       fullName.includes(searchTerm) ||
                       reverseName.includes(searchTerm) ||
                       email.includes(searchTerm) ||
                       position.includes(searchTerm);
            });
        }

        // Format results for dropdown
        const formattedResults = filteredApplicants.map(applicant => ({
            applicantId: applicant.applicantId,
            name: `${applicant.firstName} ${applicant.lastName}`,
            email: applicant.useraccounts?.userEmail || 'N/A',
            position: applicant.jobpositions?.jobTitle || 'N/A',
            status: applicant.applicantStatus || 'Pending',
            applicationDate: new Date(applicant.created_at).toISOString().split('T')[0]
        }));

        console.log(`✅ [Line Manager] Returning ${formattedResults.length} department applicants`);

        return res.json({
            success: true,
            applicants: formattedResults
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error searching department applicants:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
},

// 7. INTELLIGENT Department Applicant Status Report
getDeptApplicantStatusReport: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { applicantName, format } = req.query;
        
        console.log('🔍 [Line Manager] Searching department applicant by name...');
        
        if (!applicantName || applicantName.trim().length < 2) {
            return res.status(400).json({ success: false, message: 'Applicant name is required (minimum 2 characters)' });
        }

        // Get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;
        const searchName = applicantName.trim().toLowerCase();

        // Enhanced query for department applicants only
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
                useraccounts!inner(userEmail),
                jobpositions!inner(jobTitle)
            `)
            .eq('departmentId', departmentId)
            .order('created_at', { ascending: false });

        if (searchError) {
            console.error('❌ [Line Manager] Error searching department applicants:', searchError);
            return res.status(500).json({ success: false, message: 'Error searching department applicants: ' + searchError.message });
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
                message: `No department applicants found matching "${applicantName}". Please check the spelling and try again.`,
                searchSuggestion: true
            });
        }

        if (matchingApplicants.length > 1) {
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
                message: `Found ${matchingApplicants.length} department applicants matching "${applicantName}". Please be more specific:`,
                multipleMatches: true,
                suggestions: suggestions
            });
        }

        // Exactly one match found
        const applicant = matchingApplicants[0];

        // === INTELLIGENT STATUS ANALYSIS ===
        
        // Calculate processing metrics
        const applicationDate = new Date(applicant.created_at);
        const currentDate = new Date();
        const daysInProcess = Math.floor((currentDate - applicationDate) / (1000 * 60 * 60 * 24));
        const totalScore = (applicant.initialScreeningScore || 0) + (applicant.hrInterviewFormScore || 0) + (applicant.lineManagerFormEvalScore || 0);

        // Status progression analysis
        const statusProgression = {
            hrScreeningApproved: () => {
                const status = (applicant.applicantStatus || '').toLowerCase();
                const hrScore = applicant.hrInterviewFormScore;
                
                if (status.includes('passed hr') || status.includes('p1 passed') || (hrScore && hrScore > 0)) {
                    return 'Yes';
                }
                if (status.includes('failed hr') || status.includes('p1 failed')) {
                    return 'No';
                }
                return 'Pending';
            },
            yourReviewStatus: () => {
                const status = (applicant.applicantStatus || '').toLowerCase();
                const lineManagerScore = applicant.lineManagerFormEvalScore;
                
                if (status.includes('passed panel') || status.includes('p2 passed') || status.includes('line manager passed') || (lineManagerScore && lineManagerScore > 0)) {
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

        // Intelligence analysis
        const intelligence = {
            riskLevel: 'Low',
            recommendations: [],
            nextActions: [],
            performanceIndicators: [],
            timeline: {
                isDelayed: daysInProcess > 30,
                isUrgent: daysInProcess > 45,
                isStandard: daysInProcess <= 30
            }
        };

        // Risk assessment
        if (daysInProcess > 45) {
            intelligence.riskLevel = 'High';
            intelligence.recommendations.push('Candidate may lose interest due to lengthy process - expedite decision');
            intelligence.nextActions.push('Schedule immediate review/decision meeting');
        } else if (daysInProcess > 30) {
            intelligence.riskLevel = 'Medium';
            intelligence.recommendations.push('Process approaching maximum timeframe - prioritize this candidate');
        }

        // Performance analysis
        if (totalScore >= 240) {
            intelligence.performanceIndicators.push('Excellent candidate - scores in top 10%');
            intelligence.nextActions.push('Fast-track this high-performing candidate');
        } else if (totalScore < 150 && totalScore > 0) {
            intelligence.performanceIndicators.push('Below-average scores - carefully consider fit');
            intelligence.recommendations.push('Additional evaluation may be needed before proceeding');
        }

        // Status-specific insights
        const currentStatus = (applicant.applicantStatus || '').toLowerCase();
        if (currentStatus.includes('awaiting line manager') || currentStatus.includes('pending your review')) {
            intelligence.nextActions.push('YOUR ACTION REQUIRED: Schedule interview/review within 3 business days');
            intelligence.riskLevel = intelligence.riskLevel === 'Low' ? 'Medium' : intelligence.riskLevel;
        }

        if (statusProgression.hrScreeningApproved() === 'Yes' && statusProgression.yourReviewStatus() === 'Pending') {
            intelligence.nextActions.push('Candidate has passed HR screening - ready for your evaluation');
        }

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
                    notes: 'Initial application received for department position'
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
            applicationDate: new Date(applicant.created_at).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit' 
            }),
            daysInProcess: daysInProcess,
            currentStatus: applicant.applicantStatus || 'Pending',
            hrScreeningApproved: statusProgression.hrScreeningApproved(),
            yourReviewStatus: statusProgression.yourReviewStatus(),
            finalStatus: statusProgression.finalStatus(),
            
            // Scores
            initialScreeningScore: applicant.initialScreeningScore || 'N/A',
            hrInterviewScore: applicant.hrInterviewFormScore || 'N/A',
            yourScore: applicant.lineManagerFormEvalScore || 'N/A',
            totalScore: totalScore > 0 ? totalScore : 'N/A',
            
            // Intelligence
            riskLevel: intelligence.riskLevel,
            performanceLevel: totalScore >= 240 ? 'Excellent' : totalScore >= 180 ? 'Good' : totalScore >= 120 ? 'Average' : totalScore > 0 ? 'Below Average' : 'Not Evaluated'
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
            reportTitle: 'Department Applicant Status Report - Intelligence Enhanced'
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error in getDeptApplicantStatusReport:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
},

// 8. INTELLIGENT MRF Performance Report
getMRFPerformanceReport: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { startDate, endDate, format } = req.query;
        
        console.log('🔍 [Line Manager] Fetching MRF performance report...');
        
        // Get line manager's MRFs
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
                departments!inner(deptName)
            `)
            .eq('userId', req.session.user.userId)
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

        const { data: mrfs, error: mrfError } = await mrfQuery;

        if (mrfError) {
            console.error('❌ [Line Manager] Error fetching MRFs:', mrfError);
            throw mrfError;
        }

        console.log(`✅ [Line Manager] Found ${mrfs.length} MRFs for performance analysis`);

        // Get department applicants to calculate hires related to MRFs
        const { data: deptApplicants, error: applicantsError } = await supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                applicantStatus,
                created_at,
                departmentId,
                jobId,
                jobpositions!inner(jobTitle)
            `)
            .eq('departmentId', mrfs[0]?.departmentId || 0);

        const hiredApplicants = (deptApplicants || []).filter(applicant => {
            const status = (applicant.applicantStatus || '').toLowerCase();
            return status.includes('hired') || status.includes('onboarding');
        });

        // === INTELLIGENT MRF ANALYSIS ===

        // Process MRF performance data with intelligence
        const mrfData = mrfs.map(mrf => {
            // Smart hire attribution
            const relatedHires = hiredApplicants.filter(applicant => {
                const hireDate = new Date(applicant.created_at);
                const mrfDate = new Date(mrf.requisitionDate);
                const mrfDeadline = new Date(mrf.requiredDate);
                
                return hireDate >= mrfDate &&
                       hireDate <= new Date(mrfDeadline.getTime() + (60 * 24 * 60 * 60 * 1000)); // 60 days after deadline
            });

            const personnelHired = relatedHires.length;
            const fillRate = Math.round((personnelHired / mrf.numPersonsRequisitioned) * 100);
            const daysOpen = Math.floor((new Date() - new Date(mrf.requisitionDate)) / (1000 * 60 * 60 * 24));
            const daysUntilDeadline = Math.floor((new Date(mrf.requiredDate) - new Date()) / (1000 * 60 * 60 * 24));
            const isOverdue = new Date() > new Date(mrf.requiredDate);
            const urgencyLevel = daysUntilDeadline <= 7 ? 'Critical' : daysUntilDeadline <= 21 ? 'High' : 'Normal';

            return {
                mrfId: mrf.mrfId,
                positionTitle: mrf.positionTitle,
                requisitionDate: new Date(mrf.requisitionDate).toLocaleDateString(),
                requiredDate: new Date(mrf.requiredDate).toLocaleDateString(),
                personnelRequired: mrf.numPersonsRequisitioned,
                personnelHired: personnelHired,
                fillRate: fillRate,
                daysOpen: daysOpen,
                daysUntilDeadline: daysUntilDeadline,
                isOverdue: isOverdue,
                urgencyLevel: urgencyLevel,
                status: mrf.status,
                performanceLevel: fillRate >= 100 ? 'Excellent' : fillRate >= 75 ? 'Good' : fillRate >= 50 ? 'Average' : 'Needs Attention'
            };
        });

        // Performance analysis
        const performanceAnalysis = {
            excellentMRFs: mrfData.filter(m => m.fillRate >= 100),
            goodMRFs: mrfData.filter(m => m.fillRate >= 75 && m.fillRate < 100),
            strugglingMRFs: mrfData.filter(m => m.fillRate < 50),
            overdueMRFs: mrfData.filter(m => m.isOverdue),
            urgentMRFs: mrfData.filter(m => m.urgencyLevel === 'Critical' || m.urgencyLevel === 'High'),
            avgFillRate: mrfData.length > 0 ? Math.round(mrfData.reduce((sum, m) => sum + m.fillRate, 0) / mrfData.length) : 0,
            avgDaysOpen: mrfData.length > 0 ? Math.round(mrfData.reduce((sum, m) => sum + m.daysOpen, 0) / mrfData.length) : 0
        };

        // Intelligent insights
        const insights = [];
        const actionItems = [];
        const recommendations = [];

        // Performance insights
        if (performanceAnalysis.excellentMRFs.length > 0) {
            insights.push(`🎯 ${performanceAnalysis.excellentMRFs.length} MRFs fully filled - excellent requisition management`);
        }

        if (performanceAnalysis.strugglingMRFs.length > 0) {
            insights.push(`⚠️ ${performanceAnalysis.strugglingMRFs.length} MRFs with <50% fill rate need immediate attention`);
            actionItems.push(`Review and adjust requirements for ${performanceAnalysis.strugglingMRFs.length} underperforming MRFs`);
        }

        if (performanceAnalysis.urgentMRFs.length > 0) {
            insights.push(`🚨 ${performanceAnalysis.urgentMRFs.length} MRFs approaching deadline - urgent action required`);
            actionItems.push(`Expedite hiring process for ${performanceAnalysis.urgentMRFs.length} urgent MRFs`);
        }

        if (performanceAnalysis.overdueMRFs.length > 0) {
            insights.push(`📅 ${performanceAnalysis.overdueMRFs.length} MRFs are overdue - review requirements and timeline`);
            recommendations.push('Consider extending deadlines or adjusting requirements for overdue MRFs');
        }

        // Efficiency insights
        if (performanceAnalysis.avgDaysOpen > 60) {
            insights.push(`⏰ Average MRF open time (${performanceAnalysis.avgDaysOpen} days) indicates slow hiring process`);
            recommendations.push('Streamline recruitment process to reduce average days to fill positions');
        }

        if (performanceAnalysis.avgFillRate < 70) {
            insights.push(`📊 Overall fill rate (${performanceAnalysis.avgFillRate}%) below industry standard (80%+)`);
            recommendations.push('Review job requirements and compensation packages to improve attractiveness');
        } else if (performanceAnalysis.avgFillRate >= 90) {
            insights.push(`🏆 Outstanding fill rate (${performanceAnalysis.avgFillRate}%) exceeds industry standards`);
        }

        // Strategic insights
        const currentMonth = new Date().getMonth();
        const recentMRFs = mrfData.filter(m => new Date(m.requisitionDate).getMonth() === currentMonth);
        if (recentMRFs.length > 3) {
            insights.push(`📈 High MRF volume this month (${recentMRFs.length}) - ensure adequate recruitment resources`);
            recommendations.push('Consider temporary recruitment support for high-volume periods');
        }

        // Summary statistics
        const summary = {
            totalMRFs: mrfs.length,
            totalRequired: mrfs.reduce((sum, mrf) => sum + mrf.numPersonsRequisitioned, 0),
            totalHired: mrfData.reduce((sum, mrf) => sum + mrf.personnelHired, 0),
            yourFillRate: performanceAnalysis.avgFillRate,
            avgDaysOpen: performanceAnalysis.avgDaysOpen,
            excellentMRFs: performanceAnalysis.excellentMRFs.length,
            strugglingMRFs: performanceAnalysis.strugglingMRFs.length,
            urgentMRFs: performanceAnalysis.urgentMRFs.length,
            overdueMRFs: performanceAnalysis.overdueMRFs.length
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
            insights: insights,
            actionItems: actionItems,
            recommendations: recommendations,
            intelligence: {
                performanceAnalysis
            },
            generatedOn: generatedOn,
            reportTitle: 'Your MRF Performance Report - Intelligence Enhanced'
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error in getMRFPerformanceReport:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
},

// 9. INTELLIGENT Department Pipeline Report
getDeptPipelineReport: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { startDate, endDate, format } = req.query;
        
        console.log('🔍 [Line Manager] Fetching department pipeline report...');
        
        // Get line manager's department
        const { data: staffAccount, error: staffError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', req.session.user.userId)
            .single();

        if (staffError || !staffAccount) {
            throw new Error('Could not find department for line manager');
        }

        const departmentId = staffAccount.departmentId;

        // Get department applicants for pipeline analysis
        let query = supabase
            .from('applicantaccounts')
            .select(`
                applicantId,
                applicantStatus,
                created_at,
                initialScreeningScore,
                hrInterviewFormScore,
                lineManagerFormEvalScore,
                jobpositions!inner(jobTitle)
            `)
            .eq('departmentId', departmentId)
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
            console.error('❌ [Line Manager] Error fetching department applicants for pipeline:', error);
            throw error;
        }

        console.log(`✅ [Line Manager] Found ${applicants.length} department applicants for pipeline analysis`);

        // === INTELLIGENT PIPELINE ANALYSIS ===

        // Advanced pipeline stage analysis
        const pipelineStages = {
            applied: applicants.length,
            initialScreening: applicants.filter(a => (a.initialScreeningScore || 0) > 0 || (a.applicantStatus || '').toLowerCase().includes('screen')).length,
            hrInterview: applicants.filter(a => (a.hrInterviewFormScore || 0) > 0 || (a.applicantStatus || '').toLowerCase().includes('hr')).length,
            yourReview: applicants.filter(a => (a.lineManagerFormEvalScore || 0) > 0 || (a.applicantStatus || '').toLowerCase().includes('line manager')).length,
            hired: applicants.filter(a => (a.applicantStatus || '').toLowerCase().includes('hired')).length
        };

        // Conversion rate analysis
        const conversionRates = {
            applicationToScreening: pipelineStages.applied > 0 ? Math.round((pipelineStages.initialScreening / pipelineStages.applied) * 100) : 0,
            screeningToHR: pipelineStages.initialScreening > 0 ? Math.round((pipelineStages.hrInterview / pipelineStages.initialScreening) * 100) : 0,
            hrToYourReview: pipelineStages.hrInterview > 0 ? Math.round((pipelineStages.yourReview / pipelineStages.hrInterview) * 100) : 0,
            yourReviewToHire: pipelineStages.yourReview > 0 ? Math.round((pipelineStages.hired / pipelineStages.yourReview) * 100) : 0,
            overallConversion: pipelineStages.applied > 0 ? Math.round((pipelineStages.hired / pipelineStages.applied) * 100) : 0
        };

        // Bottleneck detection
        const bottleneckAnalysis = {
            criticalBottleneck: null,
            bottleneckStage: '',
            bottleneckImpact: 0
        };

        // Find the stage with lowest conversion rate
        const conversionStages = [
            { stage: 'Application to Screening', rate: conversionRates.applicationToScreening },
            { stage: 'Screening to HR', rate: conversionRates.screeningToHR },
            { stage: 'HR to Your Review', rate: conversionRates.hrToYourReview },
            { stage: 'Your Review to Hire', rate: conversionRates.yourReviewToHire }
        ];

        const lowestConversion = conversionStages.reduce((min, stage) => 
            stage.rate < min.rate ? stage : min
        );

        if (lowestConversion.rate < 50) {
            bottleneckAnalysis.criticalBottleneck = lowestConversion.stage;
            bottleneckAnalysis.bottleneckStage = lowestConversion.stage;
            bottleneckAnalysis.bottleneckImpact = 50 - lowestConversion.rate;
        }

        // Time-in-stage analysis
        const timeAnalysis = {
            avgTimeInPipeline: applicants.length > 0 ? Math.round(applicants.reduce((sum, a) => {
                return sum + Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
            }, 0) / applicants.length) : 0,
            stuckCandidates: applicants.filter(a => {
                const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                const status = (a.applicantStatus || '').toLowerCase();
                return days > 30 && !status.includes('hired') && !status.includes('rejected');
            }).length,
            fastTrackCandidates: applicants.filter(a => {
                const days = Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                const status = (a.applicantStatus || '').toLowerCase();
                return days <= 14 && status.includes('hired');
            }).length
        };

        // Quality flow analysis
        const qualityAnalysis = {
            highQualityInPipeline: applicants.filter(a => {
                const total = (a.initialScreeningScore || 0) + (a.hrInterviewFormScore || 0) + (a.lineManagerFormEvalScore || 0);
                return total >= 200; // High quality candidates still in pipeline
            }).length,
            avgScoreByStage: {
                initialScreening: pipelineStages.initialScreening > 0 ? Math.round(applicants.reduce((sum, a) => sum + (a.initialScreeningScore || 0), 0) / pipelineStages.initialScreening) : 0,
                hrInterview: pipelineStages.hrInterview > 0 ? Math.round(applicants.reduce((sum, a) => sum + (a.hrInterviewFormScore || 0), 0) / pipelineStages.hrInterview) : 0,
                yourReview: pipelineStages.yourReview > 0 ? Math.round(applicants.reduce((sum, a) => sum + (a.lineManagerFormEvalScore || 0), 0) / pipelineStages.yourReview) : 0
            }
        };

        // Intelligent insights generation
        const insights = [];
        const actionItems = [];
        const recommendations = [];
        
        // Pipeline health assessment
        const pipelineHealth = {
            overallHealth: 'Good',
            healthScore: 0,
            criticalIssues: [],
            strengths: []
        };

        // Calculate health score (0-100)
        let healthScore = 0;
        
        // Conversion rate contribution (40% of score)
        healthScore += Math.min(conversionRates.overallConversion * 0.4, 40);
        
        // Speed contribution (30% of score)
        const speedScore = timeAnalysis.avgTimeInPipeline <= 21 ? 30 : 
                          timeAnalysis.avgTimeInPipeline <= 35 ? 20 : 
                          timeAnalysis.avgTimeInPipeline <= 50 ? 10 : 0;
        healthScore += speedScore;
        
        // Quality contribution (30% of score)
        const qualityScore = qualityAnalysis.highQualityInPipeline >= 5 ? 30 :
                            qualityAnalysis.highQualityInPipeline >= 3 ? 20 :
                            qualityAnalysis.highQualityInPipeline >= 1 ? 10 : 0;
        healthScore += qualityScore;

        pipelineHealth.healthScore = Math.round(healthScore);
        pipelineHealth.overallHealth = healthScore >= 80 ? 'Excellent' : 
                                      healthScore >= 60 ? 'Good' : 
                                      healthScore >= 40 ? 'Fair' : 'Poor';

        // Generate intelligent insights
        if (conversionRates.overallConversion >= 15) {
            insights.push(`🎯 Strong conversion rate (${conversionRates.overallConversion}%) - excellent pipeline efficiency`);
            pipelineHealth.strengths.push('High conversion rate');
        } else if (conversionRates.overallConversion < 8) {
            insights.push(`⚠️ Low conversion rate (${conversionRates.overallConversion}%) - pipeline needs optimization`);
            pipelineHealth.criticalIssues.push('Poor conversion rate');
            recommendations.push('Review job requirements and candidate screening criteria');
        }

        if (bottleneckAnalysis.criticalBottleneck) {
            insights.push(`🔴 Critical bottleneck detected at "${bottleneckAnalysis.criticalBottleneck}" stage`);
            pipelineHealth.criticalIssues.push(`Bottleneck: ${bottleneckAnalysis.criticalBottleneck}`);
            
            // Stage-specific recommendations
            if (bottleneckAnalysis.criticalBottleneck.includes('Screening')) {
                recommendations.push('Streamline initial screening process - consider automated pre-screening');
                actionItems.push('Review and optimize screening criteria within 1 week');
            } else if (bottleneckAnalysis.criticalBottleneck.includes('HR')) {
                recommendations.push('Coordinate with HR to expedite interview scheduling');
                actionItems.push('Meet with HR team to discuss pipeline flow optimization');
            } else if (bottleneckAnalysis.criticalBottleneck.includes('Your Review')) {
                recommendations.push('Allocate more time for candidate evaluations or delegate reviews');
                actionItems.push('Schedule dedicated time blocks for candidate reviews');
            }
        }

        if (timeAnalysis.stuckCandidates > 0) {
            insights.push(`⏰ ${timeAnalysis.stuckCandidates} candidates stuck in pipeline for 30+ days`);
            actionItems.push(`Review and expedite decisions for ${timeAnalysis.stuckCandidates} long-pending candidates`);
            pipelineHealth.criticalIssues.push('Candidates stuck in pipeline');
        }

        if (timeAnalysis.fastTrackCandidates > 0) {
            insights.push(`⚡ ${timeAnalysis.fastTrackCandidates} candidates hired within 14 days - excellent speed`);
            pipelineHealth.strengths.push('Fast hiring capability');
        }

        if (qualityAnalysis.highQualityInPipeline >= 3) {
            insights.push(`💎 ${qualityAnalysis.highQualityInPipeline} high-quality candidates in pipeline - prioritize these`);
            actionItems.push('Fast-track high-scoring candidates to prevent losing them');
        }

        // Volume analysis
        const currentMonth = new Date().getMonth();
        const thisMonthApplicants = applicants.filter(a => new Date(a.created_at).getMonth() === currentMonth);
        
        if (thisMonthApplicants.length > 20) {
            insights.push(`📈 High application volume this month (${thisMonthApplicants.length}) - ensure adequate processing capacity`);
            recommendations.push('Consider additional interview slots or reviewer support');
        } else if (thisMonthApplicants.length < 5) {
            insights.push(`📉 Low application volume this month (${thisMonthApplicants.length}) - may need recruitment boost`);
            recommendations.push('Consider enhancing job posting visibility or recruitment channels');
        }

        // Efficiency benchmarks
        if (timeAnalysis.avgTimeInPipeline <= 21) {
            insights.push(`🚀 Excellent pipeline speed (${timeAnalysis.avgTimeInPipeline} days avg) - faster than industry standard`);
            pipelineHealth.strengths.push('Fast processing time');
        } else if (timeAnalysis.avgTimeInPipeline > 45) {
            insights.push(`🐌 Slow pipeline processing (${timeAnalysis.avgTimeInPipeline} days avg) - candidates may lose interest`);
            pipelineHealth.criticalIssues.push('Slow processing time');
            recommendations.push('Implement timeline targets for each pipeline stage');
        }

        // Position-specific analysis
        const positionBreakdown = {};
        applicants.forEach(applicant => {
            const position = applicant.jobpositions?.jobTitle || 'Unknown';
            if (!positionBreakdown[position]) {
                positionBreakdown[position] = {
                    total: 0,
                    hired: 0,
                    inProgress: 0,
                    avgDays: 0
                };
            }
            positionBreakdown[position].total++;
            
            if ((applicant.applicantStatus || '').toLowerCase().includes('hired')) {
                positionBreakdown[position].hired++;
            } else if (!(applicant.applicantStatus || '').toLowerCase().includes('rejected')) {
                positionBreakdown[position].inProgress++;
            }
        });

        // Calculate position-specific metrics
        Object.keys(positionBreakdown).forEach(position => {
            const posData = positionBreakdown[position];
            const positionApplicants = applicants.filter(a => (a.jobpositions?.jobTitle || 'Unknown') === position);
            
            posData.avgDays = positionApplicants.length > 0 ? Math.round(
                positionApplicants.reduce((sum, a) => {
                    return sum + Math.floor((new Date() - new Date(a.created_at)) / (1000 * 60 * 60 * 24));
                }, 0) / positionApplicants.length
            ) : 0;
            
            posData.conversionRate = posData.total > 0 ? Math.round((posData.hired / posData.total) * 100) : 0;
        });

        // Action item prioritization
        const prioritizedActions = [];
        
        if (pipelineHealth.criticalIssues.length > 0) {
            prioritizedActions.push({
                priority: 'HIGH',
                action: 'Address critical pipeline issues immediately',
                timeline: '1-3 days'
            });
        }
        
        if (timeAnalysis.stuckCandidates > 0) {
            prioritizedActions.push({
                priority: 'HIGH',
                action: `Review ${timeAnalysis.stuckCandidates} candidates stuck in pipeline`,
                timeline: '1 week'
            });
        }
        
        if (qualityAnalysis.highQualityInPipeline > 0) {
            prioritizedActions.push({
                priority: 'MEDIUM',
                action: `Fast-track ${qualityAnalysis.highQualityInPipeline} high-quality candidates`,
                timeline: '2 weeks'
            });
        }

        // Enhanced pipeline data with intelligence (NO PREDICTIVE ANALYTICS)
        const enhancedPipelineData = {
            stages: pipelineStages,
            conversionRates: conversionRates,
            timeAnalysis: timeAnalysis,
            qualityAnalysis: qualityAnalysis,
            bottleneckAnalysis: bottleneckAnalysis,
            positionBreakdown: positionBreakdown,
            pipelineHealth: pipelineHealth
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
            pipelineData: enhancedPipelineData,
            insights: insights,
            actionItems: actionItems,
            recommendations: recommendations,
            prioritizedActions: prioritizedActions,
            generatedOn: generatedOn,
            reportTitle: 'Department Pipeline Report - Intelligence Enhanced'
        });

    } catch (error) {
        console.error('❌ [Line Manager] Error in getDeptPipelineReport:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
},

getOffboardingReports: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const { startDate, endDate, type, format } = req.query;
        const managerUserId = req.session.user.userId;
        
        console.log('🔍 [Line Manager Offboarding Reports] Fetching offboarding data...');
        console.log('📅 [Line Manager Offboarding Reports] Filters:', { startDate, endDate, type, format });
        
        // First, get the manager's department
        const { data: managerData, error: managerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', managerUserId)
            .single();

        if (managerError || !managerData) {
            console.error('❌ [Line Manager Reports] Error fetching manager data:', managerError);
            return res.status(500).json({ success: false, message: 'Error fetching manager information' });
        }

        const managerDepartmentId = managerData.departmentId;
        console.log('🏢 [Line Manager Reports] Manager department ID:', managerDepartmentId);

        // Get all staff in the manager's department
        const { data: departmentStaff, error: staffError } = await supabase
            .from('staffaccounts')
            .select('userId, firstName, lastName')
            .eq('departmentId', managerDepartmentId);

        if (staffError) {
            console.error('❌ [Line Manager Reports] Error fetching department staff:', staffError);
            return res.status(500).json({ success: false, message: 'Error fetching department staff' });
        }

        const departmentUserIds = departmentStaff.map(staff => staff.userId);
        console.log(`👥 [Line Manager Reports] Found ${departmentUserIds.length} staff members in department`);

        if (departmentUserIds.length === 0) {
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
                reportTitle: 'Department Offboarding Report (Line Manager)'
            });
        }

        // Build query for offboarding requests in manager's department
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
            .in('userId', departmentUserIds)
            .order('created_at', { ascending: false });

        // Apply date filters
        if (startDate) {
            query = query.gte('created_at', startDate);
            console.log('📅 [Line Manager Reports] Applied start date filter:', startDate);
        }
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setHours(23, 59, 59, 999);
            query = query.lte('created_at', endDateTime.toISOString());
            console.log('📅 [Line Manager Reports] Applied end date filter:', endDateTime.toISOString());
        }

        // Apply type filter
        if (type && type !== 'all') {
            query = query.eq('offboardingType', type);
            console.log('📋 [Line Manager Reports] Applied type filter:', type);
        }

        const { data: offboardingData, error } = await query;

        if (error) {
            console.error('❌ [Line Manager Reports] Error fetching data:', error);
            return res.status(500).json({ success: false, message: 'Error fetching offboarding data: ' + error.message });
        }

        console.log(`✅ [Line Manager Reports] Found ${offboardingData.length} offboarding requests`);

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
                reportTitle: 'Department Offboarding Report (Line Manager)'
            });
        }

        // Get department name
        const { data: departmentData, error: deptError } = await supabase
            .from('departments')
            .select('deptName')
            .eq('departmentId', managerDepartmentId)
            .single();

        const departmentName = departmentData?.deptName || 'Unknown Department';

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

        // Process data for display
        const processedData = offboardingData.map(request => {
            // Find corresponding staff account
            const staffAccount = departmentStaff.find(staff => staff.userId === request.userId);

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
                department: departmentName,
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

        console.log('📊 [Line Manager Reports] Summary stats:', summary);

        if (format === 'pdf') {
            console.log('📄 [Line Manager Reports] PDF format requested');
            return res.json({
                success: true,
                reportType: 'department-offboarding',
                format: 'pdf',
                data: processedData,
                summary: summary,
                monthlyData: monthlyData,
                generatedOn: generatedOn,
                filters: { startDate, endDate, type },
                reportTitle: `${departmentName} - Offboarding Report (Line Manager)`,
                reportSubtitle: `Department-specific tracking of employee resignations and retirements with clearance status and timeline analysis`,
                departmentName: departmentName
            });
        }

        return res.json({
            success: true,
            data: processedData,
            summary: summary,
            monthlyData: monthlyData,
            generatedOn: generatedOn,
            reportTitle: `${departmentName} - Offboarding Report (Line Manager)`,
            departmentName: departmentName
        });

    } catch (error) {
        console.error('❌ [Line Manager Reports] Error in getOffboardingReports:', error);
        return res.status(500).json({ success: false, message: 'Internal server error: ' + error.message });
    }
},

getOffboardingDashboardStats: async function(req, res) {
    if (!req.session.user || req.session.user.userRole !== 'Line Manager') {
        return res.status(401).json({ success: false, message: 'Unauthorized access' });
    }

    try {
        const managerUserId = req.session.user.userId;
        console.log('🔍 [Line Manager Dashboard] Fetching dashboard statistics...');

        // First, get the manager's department
        const { data: managerData, error: managerError } = await supabase
            .from('staffaccounts')
            .select('departmentId')
            .eq('userId', managerUserId)
            .single();

        if (managerError || !managerData) {
            console.error('❌ [Line Manager Dashboard] Error fetching manager data:', managerError);
            throw new Error('Error fetching manager information');
        }

        const managerDepartmentId = managerData.departmentId;

        // Get all staff in the manager's department
        const { data: departmentStaff, error: staffError } = await supabase
            .from('staffaccounts')
            .select('userId')
            .eq('departmentId', managerDepartmentId);

        if (staffError) {
            console.error('❌ [Line Manager Dashboard] Error fetching department staff:', staffError);
            throw staffError;
        }

        const departmentUserIds = departmentStaff.map(staff => staff.userId);

        if (departmentUserIds.length === 0) {
            return res.json({
                success: true,
                stats: {
                    totalRequests: 0,
                    resignations: 0,
                    retirements: 0,
                    pendingRequests: 0,
                    avgProcessingTime: 0,
                    monthlyRequests: 0
                }
            });
        }

        // Get all offboarding requests for department staff
        const { data: allRequests, error: requestsError } = await supabase
            .from('offboarding_requests')
            .select(`
                requestId,
                offboardingType,
                status,
                created_at,
                last_day
            `)
            .in('userId', departmentUserIds);

        if (requestsError) {
            console.error('❌ [Line Manager Dashboard] Error fetching requests:', requestsError);
            throw requestsError;
        }

        console.log(`✅ [Line Manager Dashboard] Found ${allRequests.length} total requests for department`);

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

        console.log('📊 [Line Manager Dashboard] Final stats:', stats);

        return res.json({
            success: true,
            stats: stats
        });

    } catch (error) {
        console.error('❌ [Line Manager Dashboard] Error fetching dashboard stats:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Error fetching dashboard statistics: ' + error.message 
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
