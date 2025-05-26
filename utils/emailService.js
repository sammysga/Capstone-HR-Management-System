// Complete utils/emailService.js with Gmail Integration Support

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

// Create transporter
const createTransporter = () => {
    return nodemailer.createTransporter(emailConfig);
};

// Email templates for different statuses (including rejections)
const emailTemplates = {
    'P1 - PASSED': {
        subject: 'Congratulations! You\'ve Passed the Initial Screening - Prime Infrastructure',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #28a745;">Congratulations!</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>We are delighted to inform you that you have successfully passed the initial screening process for the <strong>${jobTitle}</strong> position at Prime Infrastructure.</p>
                    
                    <p>This is an important milestone in your application journey with us. Your qualifications and responses have impressed our initial screening team.</p>
                    
                    <h3>What's Next?</h3>
                    <ul>
                        <li>You will receive a scheduling link for your interview shortly</li>
                        <li>Our HR team will contact you within 2-3 business days</li>
                        <li>Please log into your applicant portal for updates</li>
                    </ul>
                    
                    <p>We look forward to the next step in our process together.</p>
                    
                    <p>Best regards,<br>
                    <strong>Prime Infrastructure Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },
    
    'P2 - PASSED': {
        subject: 'Great News! You\'ve Advanced to Final Interview - Prime Infrastructure',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #28a745;">Excellent Progress!</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Congratulations! We are pleased to inform you that you have successfully passed the initial interview for the <strong>${jobTitle}</strong> position.</p>
                    
                    <p>Your performance in the interview process has been impressive, and we would like to invite you for a final interview with our senior management team.</p>
                    
                    <h3>Final Interview Details:</h3>
                    <ul>
                        <li>This will be the final step in our selection process</li>
                        <li>You'll meet with senior leadership</li>
                        <li>Focus will be on cultural fit and long-term vision</li>
                        <li>Interview scheduling link will be provided shortly</li>
                    </ul>
                    
                    <p>Please continue to check your applicant portal for scheduling updates.</p>
                    
                    <p>We're excited about the possibility of having you join our team!</p>
                    
                    <p>Best regards,<br>
                    <strong>Prime Infrastructure Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },
    
    'P3 - PASSED': {
        subject: 'Welcome to Prime Infrastructure! Job Offer Inside',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #28a745; padding: 20px; text-align: center;">
                    <h1 style="color: white;">Welcome to the Team!</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p><strong>Congratulations!</strong> We are thrilled to extend a job offer for the <strong>${jobTitle}</strong> position at Prime Infrastructure.</p>
                    
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
                    
                    <p>We're excited to welcome you to the Prime Infrastructure family and look forward to your contribution to our continued success.</p>
                    
                    <p>Congratulations once again!</p>
                    
                    <p>Warm regards,<br>
                    <strong>Prime Infrastructure Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

    // REJECTION EMAIL TEMPLATES
    'P1 - FAILED': {
        subject: 'Thank You for Your Interest - Prime Infrastructure',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #6c757d;">Thank You for Your Application</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Thank you for your interest in the <strong>${jobTitle}</strong> position at Prime Infrastructure and for taking the time to complete our application process.</p>
                    
                    <p>After careful consideration of your application and qualifications, we regret to inform you that we have decided to move forward with other candidates whose experience more closely matches our current needs.</p>
                    
                    <p>We want to emphasize that this decision does not reflect on your qualifications or potential. The competition for this position was exceptionally strong, and we had many qualified candidates to consider.</p>
                    
                    <h3>What's Next?</h3>
                    <ul>
                        <li>We encourage you to apply for future openings that match your skills</li>
                        <li>Your information will remain in our talent database</li>
                        <li>Follow us on our careers page for new opportunities</li>
                        <li>We may contact you if a suitable position becomes available</li>
                    </ul>
                    
                    <p>We wish you the very best in your career search and thank you again for considering Prime Infrastructure as a potential employer.</p>
                    
                    <p>Best regards,<br>
                    <strong>Prime Infrastructure Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

    'P2 - FAILED': {
        subject: 'Thank You for Your Interview - Prime Infrastructure',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #6c757d;">Thank You for Your Interview</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Thank you for taking the time to interview with us for the <strong>${jobTitle}</strong> position at Prime Infrastructure. We enjoyed learning more about your background and experience.</p>
                    
                    <p>After careful consideration and discussion among our interview panel, we have decided to move forward with another candidate whose background and experience more closely align with our current requirements.</p>
                    
                    <p>We were impressed with your qualifications and professionalism throughout the interview process. This was a difficult decision, as we had several strong candidates.</p>
                    
                    <h3>Our Appreciation:</h3>
                    <ul>
                        <li>Thank you for your time and effort in the interview process</li>
                        <li>We value the opportunity to have met you</li>
                        <li>Your application will remain in our talent database</li>
                        <li>We encourage you to apply for future positions that match your expertise</li>
                    </ul>
                    
                    <p>We wish you continued success in your career endeavors and hope our paths may cross again in the future.</p>
                    
                    <p>Best regards,<br>
                    <strong>Prime Infrastructure Recruitment Team</strong></p>
                </div>
                <div style="background-color: #f8f9fa; padding: 10px; text-align: center; font-size: 12px; color: #6c757d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `
    },

    'P3 - FAILED': {
        subject: 'Final Interview Update - Prime Infrastructure',
        getHtml: (applicantName, jobTitle) => `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
                    <h1 style="color: #6c757d;">Thank You for Your Participation</h1>
                </div>
                <div style="padding: 20px;">
                    <p>Dear ${applicantName},</p>
                    
                    <p>Thank you for participating in our comprehensive interview process for the <strong>${jobTitle}</strong> position at Prime Infrastructure, including your final interview with our senior management team.</p>
                    
                    <p>We were impressed by your qualifications, experience, and the thoughtful responses you provided throughout our interview process. After extensive deliberation, we have made the difficult decision to extend an offer to another candidate.</p>
                    
                    <p>This decision was particularly challenging because you demonstrated excellent qualifications and would be a valuable addition to any organization.</p>
                    
                    <h3>Our Sincere Thanks:</h3>
                    <ul>
                        <li>Your professionalism throughout the entire process was exemplary</li>
                        <li>We appreciate the time and effort you invested in our interview process</li>
                        <li>Your candidacy was seriously considered at every stage</li>
                        <li>We hope you'll consider Prime Infrastructure for future opportunities</li>
                    </ul>
                    
                    <p>We strongly encourage you to apply for future positions with us that align with your career goals and expertise. We believe you have much to offer and would welcome the opportunity to consider you for other roles.</p>
                    
                    <p>Thank you again for your interest in Prime Infrastructure. We wish you tremendous success in your career journey.</p>
                    
                    <p>Best regards,<br>
                    <strong>Prime Infrastructure Recruitment Team</strong></p>
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
            from: `"Prime Infrastructure Recruitment" <${process.env.EMAIL_USER}>`,
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

// Test email function (useful for development)
const sendTestEmail = async (testEmail) => {
    try {
        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"Prime Infrastructure Test" <${process.env.EMAIL_USER}>`,
            to: testEmail,
            subject: 'Email Service Test - Prime Infrastructure',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Email Service Test</h2>
                    <p>This is a test email to verify that the email service is working correctly.</p>
                    <p>Timestamp: ${new Date().toISOString()}</p>
                </div>
            `
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ [Email Service] Test email sent:', info.messageId);
        
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ [Email Service] Test email failed:', error);
        return { success: false, error: error.message };
    }
};

// Custom email function for direct SMTP sending (if needed)
const sendCustomEmail = async (email, subject, htmlTemplate, applicantName, jobTitle) => {
    try {
        const transporter = createTransporter();
        
        // Verify SMTP connection
        try {
            await transporter.verify();
            console.log('✅ [Email Service] SMTP connection verified for custom email');
        } catch (verifyError) {
            console.error('❌ [Email Service] SMTP verification failed:', verifyError);
            return { success: false, error: verifyError.message };
        }
        
        // Replace placeholders in template
        let processedTemplate = htmlTemplate
            .replace(/\{applicantName\}/g, applicantName)
            .replace(/\{jobTitle\}/g, jobTitle)
            .replace(/\{companyName\}/g, 'Prime Infrastructure');
        
        const mailOptions = {
            from: `"Prime Infrastructure Recruitment" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: subject,
            html: processedTemplate
        };
        
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ [Email Service] Custom email sent successfully: ${info.messageId}`);
        
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('❌ [Email Service] Error sending custom email:', error);
        return { success: false, error: error.message };
    }
};

// Get email template data for frontend (Gmail Integration)
const getEmailTemplateData = () => {
    return {
        passed: {
            subject: 'Congratulations! You\'ve Passed the Initial Screening - Prime Infrastructure',
            template: `Dear {applicantName},

We are delighted to inform you that you have successfully passed the initial screening process for the {jobTitle} position at {companyName}.

This is an important milestone in your application journey with us. Your qualifications and responses have impressed our initial screening team.

What's Next?
• You will receive a scheduling link for your interview shortly
• Our HR team will contact you within 2-3 business days
• Please log into your applicant portal for updates

We look forward to the next step in our process together.

Best regards,
{companyName} Recruitment Team

---
This is an automated message. Please do not reply to this email.`
        },
        failed: {
            subject: 'Thank You for Your Interest - Prime Infrastructure',
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
{companyName} Recruitment Team

---
This is an automated message. Please do not reply to this email.`
        }
    };
};

module.exports = {
    sendStatusUpdateEmail,
    sendBatchStatusEmails,
    sendTestEmail,
    sendCustomEmail,
    getEmailTemplateData
};