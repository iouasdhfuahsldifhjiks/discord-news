document.addEventListener('DOMContentLoaded', function() {
    // Элементы DOM
    const newsForm = document.getElementById('newsForm');
    const contentTextarea = document.getElementById('content');
    const channelSelect = document.getElementById('channel');
    const roleSelect = document.getElementById('role');
    const attachmentsInput = document.getElementById('attachments');
    const previewContent = document.getElementById('previewContent');
    const scheduleCheckbox = document.getElementById('schedule');
    const scheduleDate = document.getElementById('scheduleDate');
    const addButtonBtn = document.getElementById('addButton');
    const buttonsContainer = document.getElementById('buttonsContainer');
    const filePreview = document.getElementById('filePreview');
    
    let currentFiles = [];
    
    // Инициализация
    updatePreview();
    
    // Обработчики событий
    contentTextarea.addEventListener('input', updatePreview);
    channelSelect.addEventListener('change', updatePreview);
    roleSelect.addEventListener('change', updatePreview);
    attachmentsInput.addEventListener('change', handleFileSelect);
    scheduleCheckbox.addEventListener('change', toggleScheduler);
    addButtonBtn.addEventListener('click', addButtonRow);
    
    function getCSRFToken() {
        return document.querySelector('input[name="_csrf"]').value;
    }
    
    // Обработка формы
    newsForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const submitBtn = this.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        
        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Отправка...';
            
            const formData = new FormData();
            const csrfToken = getCSRFToken();
            
            // Добавьте CSRF токен в форму
            formData.append('_csrf', csrfToken);
            // ... остальные данные формы
            
            const response = await fetch('/api/send-news', {
                method: 'POST',
                headers: {
                    'X-CSRF-Token': csrfToken // Добавьте заголовок
                },
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                showModal('✅ Успех', result.message);
                resetForm();
                // Обновляем историю
                setTimeout(() => window.location.reload(), 2000);
            } else {
                showModal('❌ Ошибка', result.error || 'Произошла ошибка при отправке');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            showModal('❌ Ошибка', 'Произошла ошибка при отправке');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    });
    
    // Функции
    function updatePreview() {
        const content = contentTextarea.value;
        const roleId = roleSelect.value;
        const channelId = channelSelect.value;
        
        let previewHtml = '';
        
        if (roleId) {
            const roleName = roleSelect.options[roleSelect.selectedIndex].text;
            previewHtml += `<p><span class="role-mention">@${roleName}</span> `;
        }
        
        // Рендерим Markdown
        try {
            previewHtml += marked.parse(content || '*Текст появится здесь...*');
        } catch (error) {
            previewHtml += content;
        }
        
        // Предпросмотр файлов
        if (currentFiles.length > 0) {
            previewHtml += '<div class="mt-3"><strong>Вложения:</strong><div class="d-flex flex-wrap mt-2">';
            currentFiles.forEach(file => {
                if (file.type.startsWith('image/')) {
                    previewHtml += `<img src="${URL.createObjectURL(file)}" class="upload-preview" alt="${file.name}">`;
                } else {
                    previewHtml += `
                        <div class="file-preview-item">
                            <i class="bi bi-file-earmark"></i>
                            <span>${file.name}</span>
                        </div>
                    `;
                }
            });
            previewHtml += '</div></div>';
        }
        
        // Предпросмотр кнопок
        const buttons = getButtonsData();
        if (buttons.length > 0) {
            previewHtml += '<div class="mt-3"><strong>Кнопки:</strong><div class="mt-2">';
            buttons.forEach(btn => {
                if (btn.label && btn.url) {
                    previewHtml += `<a href="${btn.url}" class="button" target="_blank">${btn.label}</a>`;
                }
            });
            previewHtml += '</div></div>';
        }
        
        previewContent.innerHTML = previewHtml || '<p class="text-muted">Здесь будет отображаться предпросмотр...</p>';
    }
    
    function handleFileSelect(event) {
        const files = Array.from(event.target.files);
        currentFiles = files;
        
        filePreview.innerHTML = '';
        
        files.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-preview-item';
            
            if (file.type.startsWith('image/')) {
                fileItem.innerHTML = `
                    <img src="${URL.createObjectURL(file)}" class="upload-preview" alt="${file.name}">
                    <span>${file.name} (${formatFileSize(file.size)})</span>
                `;
            } else {
                fileItem.innerHTML = `
                    <i class="bi bi-file-earmark me-2"></i>
                    <span>${file.name} (${formatFileSize(file.size)})</span>
                `;
            }
            
            filePreview.appendChild(fileItem);
        });
        
        updatePreview();
    }
    
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function toggleScheduler() {
        scheduleDate.style.display = scheduleCheckbox.checked ? 'block' : 'none';
        if (scheduleCheckbox.checked) {
            // Устанавливаем минимальную дату (текущее время + 1 минута)
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            document.getElementById('scheduledTime').min = now.toISOString().slice(0, 16);
        }
    }
    
    function addButtonRow() {
        const buttonItem = document.createElement('div');
        buttonItem.className = 'button-item mb-2 fade-in';
        buttonItem.innerHTML = `
            <div class="input-group">
                <input type="text" class="form-control" placeholder="Текст кнопки" maxlength="80">
                <input type="url" class="form-control" placeholder="https://example.com">
                <button type="button" class="btn btn-danger remove-btn">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        
        buttonsContainer.appendChild(buttonItem);
        
        // Обработчик удаления
        buttonItem.querySelector('.remove-btn').addEventListener('click', function() {
            buttonItem.remove();
            updatePreview();
        });
        
        // Обработчики изменений
        const inputs = buttonItem.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', updatePreview);
        });
    }
    
    function getButtonsData() {
        const buttons = [];
        document.querySelectorAll('.button-item').forEach(item => {
            const labelInput = item.querySelector('input[type="text"]');
            const urlInput = item.querySelector('input[type="url"]');
            
            if (labelInput.value && urlInput.value) {
                buttons.push({
                    label: labelInput.value,
                    url: urlInput.value
                });
            }
        });
        return buttons;
    }
    
    function showModal(title, message) {
        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <h5>${title}</h5>
            <p>${message}</p>
        `;
        
        const modal = new bootstrap.Modal(document.getElementById('resultModal'));
        modal.show();
    }
    
    function resetForm() {
        contentTextarea.value = '';
        roleSelect.value = '';
        attachmentsInput.value = '';
        currentFiles = [];
        filePreview.innerHTML = '';
        buttonsContainer.innerHTML = '<div class="button-item mb-2"><div class="input-group"><input type="text" class="form-control" placeholder="Текст кнопки"><input type="url" class="form-control" placeholder="https://example.com"><button type="button" class="btn btn-danger remove-btn"><i class="bi bi-trash"></i></button></div></div>';
        scheduleCheckbox.checked = false;
        scheduleDate.style.display = 'none';
        
        // Обновляем обработчики
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                this.closest('.button-item').remove();
                updatePreview();
            });
        });
        
        document.querySelectorAll('.button-item input').forEach(input => {
            input.addEventListener('input', updatePreview);
        });
        
        updatePreview();
    }
    
    // Инициализация обработчиков для существующих кнопок удаления
    document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.button-item').remove();
            updatePreview();
        });
    });
    
    // Стиль для спиннера
    const style = document.createElement('style');
    style.textContent = `
        .spin {
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});