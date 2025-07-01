const nodemailer = require('nodemailer');

// Email configuration - reads from environment variables
const emailConfig = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
};

// FIXED: Create transporter (was createTransporter, should be createTransport)
const createTransporter = () => {
    return nodemailer.createTransport(emailConfig); // FIXED: removed 'r' from createTransporter
};

// Email templates for different statuses (including rejections)
const emailTemplates = {
    'P1 - PASSED': {
        subject: 'Congratulations! You\'ve Passed the Initial Screening - Company ABC',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #28a745;">Congratulations!</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>We are delighted to inform you that you have successfully passed the initial screening process for the <strong>${jobTitle}</strong> position at Company ABC.</p>
                    
                    <p>This is an important milestone in your application journey with us. Your qualifications and responses have impressed our initial screening team.</p>
                    
                    <h3>What's Next?</h3>
                    <ul>
                        <li>You will receive a scheduling link for your interview shortly.</li>
                        <li>Our HR team will contact you within 2-3 business days.</li>
                        <li>Please log into your applicant portal for updates.</li>
                    </ul>
                    
                    <p>We look forward to the next step in our process together.</p>
                    
                    <p>Best regards,<br>
                    <strong>Company ABC Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },
    
    'P3 - PASSED': {
        subject: 'Welcome to Company ABC! Job Offer Inside',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #28a745; padding: 20px; text-align: center;">
                    <h1 style="color: white;">Welcome to the Team!</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p><strong>Congratulations!</strong> We are thrilled to extend a job offer for the <strong>${jobTitle}</strong> position at Company ABC.</p>
                    
                    <p>After careful consideration of all candidates, we believe you are the perfect fit for our team and organization.</p>
                    
                    <h3>Your Job Offer Details:</h3>
                    <ul>
                        <li>Position: <strong>${jobTitle}</strong></li>
                        <li>Status: Offer Extended</li>
                        <li>Next Steps: Please log into your applicant portal to review and respond to the offer</li>
                    </ul>
                    
                    <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h4 style="color: #155724; margin-top: 0;">Important:</h4>
                        <p style="color: #155724; margin-bottom: 0;">Please log into your applicant portal to review the complete offer details and respond within the specified timeframe.</p>
                    </div>
                    
                    <p>We're excited to welcome you to the Company ABC family and look forward to your contribution to our continued success.</p>
                    
                    <p>Congratulations once again!</p>
                    
                    <p>Warm regards,<br>
                    <strong>Company ABC Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

    // REJECTION EMAIL TEMPLATES
    'P1 - FAILED': {
        subject: 'Thank You for Your Interest - Company ABC',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #6c757d;">Thank You for Your Application</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Thank you for your interest in the <strong>${jobTitle}</strong> position at Company ABC and for taking the time to complete our application process.</p>
                    
                    <p>After careful consideration of your application and qualifications, we regret to inform you that we have decided to move forward with other candidates whose experience more closely matches our current needs.</p>
                    
                    <p>We want to emphasize that this decision does not reflect on your qualifications or potential. The competition for this position was exceptionally strong, and we had many qualified candidates to consider.</p>
                    
                    <h3>What's Next?</h3>
                    <ul>
                        <li>We encourage you to apply for future openings that match your skills</li>
                        <li>Your information will remain in our talent database</li>
                        <li>Follow us on our careers page for new opportunities</li>
                        <li>We may contact you if a suitable position becomes available</li>
                    </ul>
                    
                    <p>We wish you the very best in your career search and thank you again for considering Company ABC as a potential employer.</p>
                    
                    <p>Best regards,<br>
                    <strong>Company ABC Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

   'P2 - PASSED': {
        subject: 'Great News! You\'ve Advanced to Final Interview - Company ABC',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #28a745; padding: 20px; text-align: center;">
                    <h1 style="color: white;">🎯 Great News!</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p><strong>Congratulations!</strong> We are excited to inform you that you have successfully passed the HR interview stage for the <strong>${jobTitle}</strong> position at Company ABC.</p>
                    
                    <p>Your performance during the HR interview was impressive, and our team was particularly pleased with your responses, qualifications, and the enthusiasm you demonstrated for joining our organization.</p>
                    
                    <h3>🎯 Final Interview Details:</h3>
                    <ul>
                        <li><strong>Next Stage:</strong> Final interview with the Line Manager and senior team members</li>
                        <li><strong>Focus Areas:</strong> Technical competencies, role-specific scenarios, and team fit assessment</li>
                        <li><strong>Duration:</strong> Approximately 45-60 minutes</li>
                        <li><strong>Format:</strong> In-person or virtual (details will be provided separately)</li>
                    </ul>
                    
                    <h3>📋 What to Expect:</h3>
                    <ul>
                        <li>Discussion about your technical skills and experience relevant to the role</li>
                        <li>Scenario-based questions related to the position</li>
                        <li>Opportunity to meet your potential direct supervisor</li>
                        <li>Q&A session about the role, team, and company culture</li>
                        <li>Discussion about career growth opportunities</li>
                    </ul>
                    
                    <h3>⏰ Next Steps:</h3>
                    <ul>
                        <li>Our scheduling team will contact you within <strong>2-3 business days</strong> to arrange your final interview</li>
                        <li>Please keep your calendar flexible for the upcoming week</li>
                        <li>Check your applicant portal regularly for updates</li>
                        <li>Prepare questions about the role and our team dynamics</li>
                    </ul>
                    
                    <div style="background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h4 style="color: #155724; margin-top: 0;">💡 Interview Preparation Tips:</h4>
                        <ul style="color: #155724; margin-bottom: 0;">
                            <li>Review the job description and prepare specific examples from your experience</li>
                            <li>Research our recent projects and company developments</li>
                            <li>Think about how your skills align with our team's current goals</li>
                            <li>Prepare thoughtful questions about the role and team structure</li>
                        </ul>
                    </div>
                    
                    <p>We're excited about the possibility of you joining our team and look forward to the final stage of our interview process.</p>
                    
                    <p>Best of luck with your preparation!</p>
                    
                    <p>Best regards,<br>
                    <strong>Company ABC HR Team</strong></p>
                    
                    <p><em>P.S. If you have any questions or concerns before your final interview, please don't hesitate to reach out to our HR team.</em></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

    'P2 - FAILED': {
        subject: 'Thank You for Your Interview - Company ABC',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #6c757d;">Thank You for Your Participation</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Thank you for taking the time to interview with us for the <strong>${jobTitle}</strong> position at Company ABC. We genuinely enjoyed learning more about your background, experience, and career aspirations during our HR interview process.</p>
                    
                    <p>After careful consideration and thorough discussion among our interview panel, we have decided to move forward with another candidate whose background and experience more closely align with our current requirements for this specific role.</p>
                    
                    <p>We want you to know that this was a difficult decision for our team. We were impressed with your qualifications, professionalism, and enthusiasm throughout the entire interview process, and you demonstrated many of the qualities we value highly at Company ABC.</p>
                    
                    <h3>🙏 Our Sincere Appreciation:</h3>
                    <ul>
                        <li>Thank you for your time and effort in preparing for and participating in our comprehensive interview process</li>
                        <li>We value the opportunity to have met you and learned about your professional experience and goals</li>
                        <li>Your professionalism and enthusiasm were evident throughout all our interactions</li>
                        <li>We appreciate your interest in Company ABC and the energy you brought to the interview</li>
                    </ul>
                    
                    <h3>🚀 Moving Forward:</h3>
                    <ul>
                        <li>Your application and interview details will remain in our talent database for future opportunities</li>
                        <li>We may contact you if a suitable position becomes available that better matches your background and experience</li>
                        <li>Please feel free to apply for other positions with us that align with your skills and career interests</li>
                        <li>Follow our careers page and LinkedIn for new openings that might be a good fit for your profile</li>
                    </ul>
                    
                    <div style="background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h4 style="color: #0066cc; margin-top: 0;">🌟 Stay Connected:</h4>
                        <p style="color: #0066cc; margin-bottom: 0;">We encourage you to connect with us on LinkedIn and follow our company updates. The talent and experience you bring to the table are valuable, and we believe you'll find an excellent opportunity that's the right fit for your career goals.</p>
                    </div>
                    
                    <p>We recognize that job searching can be challenging, and we wish you continued success in your career endeavors. We hope our paths may cross again in the future, and we encourage you to stay connected with Company ABC.</p>
                    
                    <p>Thank you again for your interest in joining our team.</p>
                    
                    <p>Best regards,<br>
                    <strong>Company ABC HR Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

    'P3 - FAILED': {
        subject: 'Final Interview Update - Company ABC',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #6c757d;">Thank You for Your Participation</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Thank you for participating in our comprehensive interview process for the <strong>${jobTitle}</strong> position at Company ABC, including your final interview with our senior management team.</p>
                    
                    <p>We were impressed by your qualifications, experience, and the thoughtful responses you provided throughout our interview process. After extensive deliberation, we have made the difficult decision to extend an offer to another candidate.</p>
                    
                    <p>This decision was particularly challenging because you demonstrated excellent qualifications and would be a valuable addition to any organization.</p>
                    
                    <h3>Our Sincere Thanks:</h3>
                    <ul>
                        <li>Your professionalism throughout the entire process was exemplary</li>
                        <li>We appreciate the time and effort you invested in our interview process</li>
                        <li>Your candidacy was seriously considered at every stage</li>
                        <li>We hope you'll consider Company ABC for future opportunities</li>
                    </ul>
                    
                    <p>We strongly encourage you to apply for future positions with us that align with your career goals and expertise. We believe you have much to offer and would welcome the opportunity to consider you for other roles.</p>
                    
                    <p>Thank you again for your interest in Company ABC. We wish you tremendous success in your career journey.</p>
                    
                    <p>Best regards,<br>
                    <strong>Company ABC Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    }
};

// Main email sending function (kept for backward compatibility)
const sendStatusUpdateEmail = async (applicantEmail, applicantName, jobTitle, status) => {
    try {
        console.log(`📧 [Email Service] Preparing to send email for status: ${status}`);
        
        // Check if we have a template for this status
        const template = emailTemplates[status];
        if (!template) {
            console.log(`⚠️ [Email Service] No email template found for status: ${status}`);
            return { success: false, message: 'No email template for this status' };
        }
        
        // Create transporter
        const transporter = createTransporter();
        
        // Verify SMTP connection
        try {
            await transporter.verify();
            console.log('✅ [Email Service] SMTP connection verified');
        } catch (verifyError) {
            console.error('❌ [Email Service] SMTP verification failed:', verifyError);
            return { success: false, message: 'SMTP connection failed', error: verifyError.message };
        }
        
        // Prepare email content
        const mailOptions = {
            from: `"Company ABC Recruitment" <${process.env.EMAIL_USER}>`,
            to: applicantEmail,
            subject: template.subject,
            html: template.getHtml(applicantName, jobTitle)
        };
        
        // Send email
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ [Email Service] Email sent successfully: ${info.messageId}`);
        
        return {
            success: true,
            messageId: info.messageId,
            message: 'Email sent successfully'
        };
        
    } catch (error) {
        console.error('❌ [Email Service] Error sending email:', error);
        return {
            success: false,
            error: error.message,
            message: 'Failed to send email'
        };
    }
};

// Function to send batch emails (useful for bulk status updates)
const sendBatchStatusEmails = async (applicants, status) => {
    const results = [];
    
    for (const applicant of applicants) {
        try {
            const result = await sendStatusUpdateEmail(
                applicant.email,
                applicant.name,
                applicant.jobTitle,
                status
            );
            
            results.push({
                email: applicant.email,
                success: result.success,
                messageId: result.messageId || null,
                error: result.error || null
            });
            
            // Add delay between emails to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.error(`❌ [Email Service] Error sending email to ${applicant.email}:`, error);
            results.push({
                email: applicant.email,
                success: false,
                error: error.message
            });
        }
    }
    
    return results;
};

// // Test email function (useful for development)
// const sendTestEmail = async (testEmail) => {
//     try {
//         const transporter = createTransporter();
        
//         const mailOptions = {
//             from: `"Company ABC Test" <${process.env.EMAIL_USER}>`,
//             to: testEmail,
//             subject: 'Email Service Test - Company ABC',
//             html: `
//                 <div style="font-family: Arial, sans-serif; padding: 20px;">
//                     <h2>Email Service Test</h2>
//                     <p>This is a test email to verify that the email service is working correctly.</p>
//                     <p>Timestamp: ${new Date().toISOString()}</p>
//                 </div>
//             `
//         };
        
//         const info = await transporter.sendMail(mailOptions);
//         console.log('✅ [Email Service] Test email sent:', info.messageId);
        
//         return { success: true, messageId: info.messageId };
//     } catch (error) {
//         console.error('❌ [Email Service] Test email failed:', error);
//         return { success: false, error: error.message };
//     }
// };

// FIXED: Custom email function for direct SMTP sending
const sendCustomEmail = async (email, subject, htmlTemplate, applicantName, jobTitle) => {
    try {
        console.log(`📧 [Email Service] FIXED: Sending custom email to: ${email} with formatting preservation`);
        
        const transporter = createTransporter();
        
        // Verify SMTP connection
        try {
            await transporter.verify();
            console.log('✅ [Email Service] SMTP connection verified for custom email');
        } catch (verifyError) {
            console.error('❌ [Email Service] SMTP verification failed:', verifyError);
            return { success: false, error: verifyError.message };
        }
        
        // FIXED: Check if template is already processed (contains actual names instead of placeholders)
        let processedTemplate;
        
        if (htmlTemplate.includes('{applicantName}') || htmlTemplate.includes('{jobTitle}') || htmlTemplate.includes('{companyName}')) {
            // Template has placeholders, process them
            console.log('📧 [Email Service] FIXED: Processing template placeholders');
            processedTemplate = htmlTemplate
                .replace(/\{applicantName\}/g, applicantName)
                .replace(/\{jobTitle\}/g, jobTitle)
                .replace(/\{companyName\}/g, 'Company ABC');
        } else {
            // Template is already processed, use as-is
            console.log('📧 [Email Service] FIXED: Using pre-processed template');
            processedTemplate = htmlTemplate;
        }
        
        // FIXED: Convert plain text template to HTML while preserving formatting
        const htmlContent = convertPlainTextToHtml(processedTemplate);
        
        const mailOptions = {
            from: `"Company ABC Recruitment" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: subject,
            html: htmlContent,
            text: processedTemplate // Also include plain text version
        };
        
        console.log('📧 [Email Service] FIXED: Sending email with preserved formatting');
        console.log('📧 [Email Service] FIXED: Subject:', subject);
        console.log('📧 [Email Service] FIXED: To:', email);
        
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ [Email Service] Custom email sent successfully: ${info.messageId}`);
        
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('❌ [Email Service] Error sending custom email:', error);
        return { success: false, error: error.message };
    }
};

const convertPlainTextToHtml = (plainText) => {
    // Convert plain text to HTML while preserving line breaks and formatting
    let htmlContent = plainText
        // Escape HTML characters first
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Convert line breaks to HTML
        .replace(/\r\n/g, '<br>')
        .replace(/\n/g, '<br>')
        .replace(/\r/g, '<br>')
        // Convert multiple spaces to non-breaking spaces
        .replace(/  +/g, (match) => '&nbsp;'.repeat(match.length))
        // Convert tabs to 4 non-breaking spaces
        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
    
    // Wrap in basic HTML structure with styling for better email rendering
    const styledHtmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
            <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                ${htmlContent}
            </div>
            <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px; text-align: center; font-size: 12px; color: #6c757d;">
                <p>This is an automated message from Company ABC. Please do not reply to this email.</p>
            </div>
        </div>
    `;
    
    return styledHtmlContent;
};

// UPDATED: Get email template data for frontend (Gmail Integration)
// This function handles both P1 and P2 templates based on the phase parameter
const getEmailTemplateData = (phase = 'P1') => {
    const templates = {
        P1: {
            passed: {
                subject: 'Congratulations! You\'ve Passed the Initial Screening - Company ABC',
                template: `Dear {applicantName},

Congratulations! You have successfully passed the initial screening process for the {jobTitle} position at {companyName}.

This is an important milestone in your application journey with us. Your qualifications and responses have impressed our initial screening team.

What's Next?
• You will receive a scheduling link for your interview shortly
• Our HR team will contact you within 2-3 business days  
• Please log into your applicant portal for updates

We look forward to the next step in our process together.

Best regards,
The {companyName} Recruitment Team`
            },
            failed: {
                subject: 'Thank You for Your Interest - Company ABC',
                template: `Dear {applicantName},

Thank you for your interest in the {jobTitle} position at {companyName} and for taking the time to complete our application process.

After careful consideration of your application and qualifications, we regret to inform you that we have decided to move forward with other candidates whose experience more closely matches our current needs.

We want to emphasize that this decision does not reflect on your qualifications or potential. The competition for this position was exceptionally strong, and we had many qualified candidates to consider.

What's Next?
• We encourage you to apply for future openings that match your skills
• Your information will remain in our talent database
• Follow us on our careers page for new opportunities
• We may contact you if a suitable position becomes available

We wish you the very best in your career search and thank you again for considering {companyName} as a potential employer.

Best regards,
The {companyName} Recruitment Team`
            }
        },
        P3: {
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
        }
    };
    
    return templates[phase] || templates.P1;
};

// Helper function to convert HTML template to plain text for Gmail
const convertHtmlToPlainText = (html) => {
    // Simple HTML to text conversion
    let plainText = html
        // Remove HTML tags
        .replace(/<[^>]*>/g, '')
        // Replace HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        // Clean up extra whitespace
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();
    
    // Add some basic formatting for better readability
    plainText = plainText
        .replace(/Dear\s+/gi, '\nDear ')
        .replace(/Best regards/gi, '\n\nBest regards')
        .replace(/Thank you/gi, '\n\nThank you')
        .replace(/Congratulations/gi, '\n\nCongratulations')
        .replace(/🎯 Final Interview Details:/gi, '\n\n🎯 Final Interview Details:')
        .replace(/📋 What to Expect:/gi, '\n\n📋 What to Expect:')
        .replace(/⏰ Next Steps:/gi, '\n\n⏰ Next Steps:')
        .replace(/🙏 Our Sincere Appreciation:/gi, '\n\n🙏 Our Sincere Appreciation:')
        .replace(/🚀 Moving Forward:/gi, '\n\n🚀 Moving Forward:')
        .replace(/P\.S\./gi, '\n\nP.S.')
        .replace(/---/g, '\n\n---');
    
    return plainText;
};

// NEW: Get raw email templates (for direct access to emailTemplates object)
const getRawEmailTemplates = () => {
    return emailTemplates;
};

// NEW: Get specific template by status
const getTemplateByStatus = (status) => {
    return emailTemplates[status] || null;
};

module.exports = {
    sendStatusUpdateEmail,
    sendBatchStatusEmails,
   sendCustomEmail: sendCustomEmail,
    getEmailTemplateData: getEmailTemplateData, // Use the fixed version
    getRawEmailTemplates,
    getTemplateByStatus,  // UNIFIED: Single function that handles all phases
    getRawEmailTemplates, 
    convertPlainTextToHtml, // NEW: Direct access to emailTemplates object
    getTemplateByStatus    // NEW: Get specific template by status
};