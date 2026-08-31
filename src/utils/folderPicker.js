const { exec } = require('child_process');

/**
 * Opens modern Windows 10/11 File Explorer folder dialog with FOS_PICKFOLDERS
 * @returns {Promise<string|null>} Selected folder path or null
 */
function openNativeSystemFolderPicker() {
  return new Promise((resolve) => {
    const csharpCode = `
using System;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

public class ModernFolderPicker {
    [STAThread]
    public static void Main() {
        try {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = "Select Backup Destination Folder";
            dialog.CheckFileExists = false;
            dialog.CheckPathExists = true;
            dialog.ValidateNames = false;
            dialog.FileName = "Select Folder";
            dialog.Filter = "Folders|no_file";

            Type type = typeof(FileDialog);
            MethodInfo getOptionsMethod = type.GetMethod("GetOptions", BindingFlags.Instance | BindingFlags.NonPublic);
            MethodInfo setOptionsMethod = type.GetMethod("SetOptions", BindingFlags.Instance | BindingFlags.NonPublic);

            if (getOptionsMethod != null && setOptionsMethod != null) {
                uint options = (uint)getOptionsMethod.Invoke(dialog, null);
                options |= 0x00000020; // FOS_PICKFOLDERS (Modern Windows Explorer dialog)
                setOptionsMethod.Invoke(dialog, new object[] { options });
            }

            if (dialog.ShowDialog() == DialogResult.OK) {
                string selected = dialog.FileName;
                if (Directory.Exists(selected)) {
                    Console.Write(selected);
                } else {
                    string dir = Path.GetDirectoryName(selected);
                    Console.Write(dir ?? selected);
                }
            }
        } catch {
            // fallback
        }
    }
}
`;

    const psScript = `
Add-Type -TypeDefinition @'
${csharpCode}
'@ -ReferencedAssemblies System.Windows.Forms
[ModernFolderPicker]::Main()
`;

    const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -STA -EncodedCommand ${encodedCommand}`;

    exec(command, { timeout: 120000 }, (error, stdout) => {
      if (error) {
        return resolve(null);
      }
      const selected = (stdout || '').trim();
      resolve(selected || null);
    });
  });
}

module.exports = { openNativeSystemFolderPicker };
