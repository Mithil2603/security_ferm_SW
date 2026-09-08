import { useState } from 'react';
import { BookOpen, Search, ChevronRight, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

const documentationTopics = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: <BookOpen className="w-5 h-5 text-indigo-500" />,
    content: (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Welcome to SecurManage</h3>
        <p className="text-slate-600">SecurManage is a comprehensive software designed for security agencies to manage employees, clients, invoicing, and payroll efficiently.</p>
        <ul className="list-disc pl-5 text-slate-600 space-y-2">
          <li><strong>Dashboard:</strong> Provides an overview of key metrics like active employees, pending invoices, and monthly revenue.</li>
          <li><strong>Sidebar Navigation:</strong> Use the left sidebar to navigate between different modules.</li>
        </ul>
      </div>
    )
  },
  {
    id: 'manage-clients',
    title: 'Managing Clients',
    icon: <FileText className="w-5 h-5 text-emerald-500" />,
    content: (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Adding and Managing Clients</h3>
        <p className="text-slate-600">Clients are the societies, apartments, or businesses you provide security for.</p>
        <ol className="list-decimal pl-5 text-slate-600 space-y-2">
          <li>Navigate to the <strong>Clients</strong> tab in the sidebar.</li>
          <li>Click the <strong>Add Client</strong> button in the top right.</li>
          <li>Fill in the necessary details like Name, Address, Monthly Rate, and Contract Dates.</li>
          <li>Click <strong>Save</strong>. You can now assign employees to this client.</li>
        </ol>
        <div className="mt-4 p-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm flex gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p>Tip: You can use the "Import Excel" button to bulk upload clients.</p>
        </div>
      </div>
    )
  },
  {
    id: 'manage-employees',
    title: 'Managing Employees',
    icon: <CheckCircle2 className="w-5 h-5 text-teal-500" />,
    content: (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Onboarding Employees</h3>
        <p className="text-slate-600">Keep track of your security personnel, their assignments, and their salary structures.</p>
        <ol className="list-decimal pl-5 text-slate-600 space-y-2">
          <li>Navigate to the <strong>Employees</strong> tab.</li>
          <li>Click <strong>Onboard Employee</strong>.</li>
          <li>Fill out their personal details, assign a Salary Structure, and assign them to a Client site.</li>
          <li>Save the profile.</li>
        </ol>
      </div>
    )
  },
  {
    id: 'invoicing-payroll',
    title: 'Invoicing & Payroll',
    icon: <FileText className="w-5 h-5 text-amber-500" />,
    content: (
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Monthly Billing</h3>
        <p className="text-slate-600">Generate automated invoices for your clients and salary slips for your employees.</p>
        <ul className="list-disc pl-5 text-slate-600 space-y-2">
          <li><strong>Invoicing:</strong> Go to the Invoices tab and click "Generate Monthly Invoices". The system will automatically calculate bills based on client contracts and employee attendance.</li>
          <li><strong>Payroll:</strong> Go to the Payroll tab to generate salary slips for the month. Basic Salary, HRA, PF deductions (if applicable), and advances are computed automatically.</li>
        </ul>
      </div>
    )
  }
];

export default function HelpDocumentation() {
  const [activeTopic, setActiveTopic] = useState(documentationTopics[0]);
  const [search, setSearch] = useState('');

  const filteredTopics = documentationTopics.filter(topic => 
    topic.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-indigo-600" />
          Help & Documentation
        </h1>
        <p className="text-slate-500 text-sm mt-1">Learn how to use the software effectively.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">
        {/* Sidebar Navigation */}
        <div className="w-full md:w-1/3 lg:w-1/4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search topics..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredTopics.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No topics found.</p>
            ) : (
              <ul className="space-y-1">
                {filteredTopics.map(topic => (
                  <li key={topic.id}>
                    <button
                      onClick={() => setActiveTopic(topic)}
                      className={`w-full text-left px-3 py-3 rounded-lg text-sm font-medium flex items-center justify-between transition-colors ${
                        activeTopic.id === topic.id 
                          ? 'bg-indigo-50 text-indigo-700' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {topic.icon}
                        {topic.title}
                      </div>
                      {activeTopic.id === topic.id && <ChevronRight className="w-4 h-4 text-indigo-500" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="w-full md:w-2/3 lg:w-3/4 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
            <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-200">
              {activeTopic.icon}
            </div>
            <h2 className="text-xl font-bold text-slate-800">{activeTopic.title}</h2>
          </div>
          <div className="p-6 overflow-y-auto flex-1 prose prose-slate max-w-none">
            {activeTopic.content}
          </div>
        </div>
      </div>
    </div>
  );
}
